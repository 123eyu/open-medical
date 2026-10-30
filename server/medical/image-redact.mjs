// 图片打码：把文字脱敏的结果映射回 OCR 行坐标，在原图上用黑块不可逆地
// 遮住姓名、电话、证件号、住址等。输出图片不带 EXIF 等元数据。
//
// 步骤：
// 1. replacedSpans(原文, 脱敏文本)：脱敏只把敏感片段换成 [患者姓名] 这类
//    占位符，按字面片段对齐即可还原出被替换的原文片段；
// 2. 对每个 OCR 行，在行文字里找这些片段，按字符位置比例算出横向区域；
//    跨行的片段（地址折行）整行遮住；
// 3. sharp 叠加黑色矩形，重新编码为 JPEG（丢弃元数据）。
// 任一需要遮的行没有坐标时，结果标为 complete=false，调用方不应把这张图
// 交给模型。

const PLACEHOLDER = /\[[^\]\n]{1,12}\]|［已脱敏］/g;
const MAX_CELLS = 4_000_000;

// 原文中没能与脱敏文本对上的字符段（字符级最长公共子序列）。占位符先换成
// 一个私用区字符，避免「[患者姓名]」里的字和原文误配。脱敏服务可能顺带
// 合并空格或吞掉相邻的字，对齐不要求逐字相同；多出来的差异宁可多遮。
function unmatchedRuns(a, b) {
  const n = a.length,
    m = b.length;
  if (!n) return [];
  if ((n + 1) * (m + 1) > MAX_CELLS) return null;
  const width = m + 1;
  const dp = new Uint16Array((n + 1) * width);
  for (let i = n - 1; i >= 0; i--)
    for (let j = m - 1; j >= 0; j--)
      dp[i * width + j] = a[i] === b[j] ? dp[(i + 1) * width + j + 1] + 1 : Math.max(dp[(i + 1) * width + j], dp[i * width + j + 1]);
  const runs = [];
  let run = "";
  let i = 0,
    j = 0;
  while (i < n) {
    if (j < m && a[i] === b[j]) {
      if (run) runs.push(run);
      run = "";
      i++;
      j++;
    } else if (j < m && dp[i * width + j + 1] >= dp[(i + 1) * width + j]) j++;
    else run += a[i++];
  }
  if (run) runs.push(run);
  return runs;
}

export function replacedSpans(raw, deid) {
  const rawText = String(raw);
  const deidText = String(deid).replace(PLACEHOLDER, "");
  const rawLines = rawText.split("\n");
  const deidLines = deidText.split("\n");
  let runs = [];
  if (rawLines.length === deidLines.length) {
    for (let k = 0; k < rawLines.length; k++) {
      if (rawLines[k] === deidLines[k]) continue;
      const found = unmatchedRuns(rawLines[k], deidLines[k]);
      if (!found) return null;
      runs.push(...found);
    }
  } else {
    const found = unmatchedRuns(rawText, deidText);
    if (!found) return null;
    runs = found;
  }
  return [...new Set(runs.flatMap((r) => r.split("\n")).map((r) => r.trim()).filter((r) => r.length >= 2))];
}

// OCR 框统一成像素矩形：支持 worker 的 [x1,y1,x2,y2]、四点多边形，以及
// 系统 OCR 的 {x,y,width,height}（0–1 归一化，y 自顶向下）。
export function boxRect(box, width, height) {
  if (!box) return null;
  if (Array.isArray(box) && box.length === 4 && box.every((v) => typeof v === "number"))
    return { x: box[0], y: box[1], w: box[2] - box[0], h: box[3] - box[1] };
  if (Array.isArray(box) && box.every((p) => Array.isArray(p) && p.length >= 2)) {
    const xs = box.map((p) => p[0]),
      ys = box.map((p) => p[1]);
    return { x: Math.min(...xs), y: Math.min(...ys), w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) };
  }
  if (typeof box === "object" && ["x", "y", "width", "height"].every((k) => typeof box[k] === "number")) {
    const ratio = box.x <= 1.0001 && box.y <= 1.0001 && box.width <= 1.0001 && box.height <= 1.0001;
    return ratio
      ? { x: box.x * width, y: box.y * height, w: box.width * width, h: box.height * height }
      : { x: box.x, y: box.y, w: box.width, h: box.height };
  }
  return null;
}

const charWidth = (ch) => (/[\u2E80-\u9FFF\u3000-\u303F\uFF00-\uFFEF\uAC00-\uD7AF]/.test(ch) ? 1 : 0.55);

// 返回需要遮挡的矩形；missing 为需要遮却没有坐标的行数。
export function redactionRects(lines, secrets, width, height) {
  const rects = [];
  let missing = 0;
  for (const line of lines || []) {
    const text = String(line.text || "");
    if (!text) continue;
    const ranges = [];
    for (const secret of secrets) {
      let from = 0;
      for (;;) {
        const at = text.indexOf(secret, from);
        if (at < 0) break;
        ranges.push([at, at + secret.length]);
        from = at + secret.length;
      }
      // 折行：本行是某个片段的一部分。
      if (text.trim().length >= 2 && secret.includes(text.trim())) ranges.push([0, text.length]);
    }
    if (!ranges.length) continue;
    const rect = boxRect(line.box, width, height);
    if (!rect || !(rect.w > 0) || !(rect.h > 0)) {
      missing++;
      continue;
    }
    // 按字宽加权定位（中文/全角约为半角的两倍宽）；OCR 文本不含原图里的
    // 空格，位置会有偏差，两侧各多遮约一个字宽，宁可多遮不能漏。
    const offsets = [0];
    for (const ch of text) offsets.push(offsets.at(-1) + charWidth(ch));
    const chars = [...text];
    const unit = rect.w / offsets.at(-1);
    const pad = Math.max(2, rect.h * 0.15);
    for (const [start, end] of ranges) {
      // ranges 是 UTF-16 下标，换成字符下标。
      const from = [...text.slice(0, start)].length,
        to = Math.min(chars.length, from + [...text.slice(start, end)].length);
      const x0 = rect.x + offsets[from] * unit - unit;
      const x1 = rect.x + offsets[to] * unit + unit;
      rects.push({
        x: Math.max(0, Math.floor(x0)),
        y: Math.max(0, Math.floor(rect.y - pad)),
        w: Math.ceil(x1 - Math.max(0, x0)),
        h: Math.ceil(rect.h + pad * 2),
      });
    }
  }
  return { rects, missing };
}

export async function redactImage(data, lines, secrets) {
  const { default: sharp } = await import("sharp");
  const meta = await sharp(data).metadata();
  const width = meta.width,
    height = meta.height;
  const { rects, missing } = redactionRects(lines, secrets, width, height);
  const clipped = rects
    .map((r) => ({ ...r, w: Math.min(r.w, width - r.x), h: Math.min(r.h, height - r.y) }))
    .filter((r) => r.w > 0 && r.h > 0);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">${clipped
    .map((r) => `<rect x="${r.x}" y="${r.y}" width="${r.w}" height="${r.h}" fill="#000"/>`)
    .join("")}</svg>`;
  const image = await sharp(data)
    .composite(clipped.length ? [{ input: Buffer.from(svg), top: 0, left: 0 }] : [])
    .jpeg({ quality: 90 })
    .toBuffer();
  return { image, masked: clipped.length, complete: missing === 0 };
}
