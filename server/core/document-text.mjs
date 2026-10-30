// Text extraction for project-workspace files that are not plain text.
// Runs in-process (no Docker): PDF via PDF.js, DOCX/XLSX via the shared Office
// extractor, PPTX by reading slide XML. Data only — never runs macros,
// formulas, scripts or external links.
import { extractOfficeText } from "../../shared/office-text.mjs";

export const DOCUMENT_EXTENSIONS = /\.(pdf|docx|xlsx|pptx)$/i;
export const IMAGE_EXTENSIONS = /\.(png|jpe?g|webp|gif|bmp|tiff?|heic)$/i;
export const DOCUMENT_READ_LIMIT = 20 * 1024 * 1024;
const MAX_CHARS = 400000;

const decodeXml = (value) =>
  value
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec) => String.fromCodePoint(Number(dec)))
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");

// Paragraphs (<a:p>) become lines; text runs (<a:t>) inside are concatenated.
function drawingText(xml) {
  const lines = [];
  for (const paragraph of xml.match(/<a:p[\s>][\s\S]*?<\/a:p>/g) || []) {
    const text = [...paragraph.matchAll(/<a:t(?:\s[^>]*)?>([\s\S]*?)<\/a:t>/g)]
      .map((m) => decodeXml(m[1]))
      .join("");
    if (text.trim()) lines.push(text);
  }
  return lines.join("\n");
}

export async function extractPptxText(bytes) {
  const { default: JSZip } = await import("jszip");
  const zip = await JSZip.loadAsync(bytes);
  const order = (name) => Number(name.match(/(\d+)\.xml$/)?.[1] || 0);
  const slides = Object.keys(zip.files)
    .filter((name) => /^ppt\/slides\/slide\d+\.xml$/.test(name))
    .sort((a, b) => order(a) - order(b));
  if (!slides.length) throw new Error("PPTX 中没有找到幻灯片");
  const parts = [];
  let chars = 0;
  for (const name of slides) {
    const n = order(name);
    const body = drawingText(await zip.file(name).async("string"));
    const notesFile = zip.file(`ppt/notesSlides/notesSlide${n}.xml`);
    const notes = notesFile ? drawingText(await notesFile.async("string")) : "";
    const block =
      `[幻灯片 ${n}]\n${body || "[本页没有文字]"}` +
      (notes ? `\n[备注]\n${notes}` : "");
    chars += block.length;
    if (chars > MAX_CHARS) throw new Error(`PPT 文本超过 ${MAX_CHARS} 字符`);
    parts.push(block);
  }
  return { text: parts.join("\n\n"), extraction: { type: "pptx_text", slideCount: slides.length } };
}

export async function extractDocumentText(bytes, name) {
  const data = new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (/\.pdf$/i.test(name)) {
    const { getDocument } = await import("pdfjs-dist/legacy/build/pdf.mjs");
    const { extractPdfText } = await import("../../shared/pdf-text.mjs");
    // PDF.js may transfer the buffer it is given; hand it a copy.
    return extractPdfText(new Uint8Array(data), getDocument, {
      maxChars: MAX_CHARS,
      maxBytes: DOCUMENT_READ_LIMIT,
      allowEmpty: true,
    });
  }
  if (/\.pptx$/i.test(name)) return extractPptxText(data);
  if (/\.(docx|xlsx)$/i.test(name))
    return extractOfficeText(new Uint8Array(data), name, {
      maxBytes: DOCUMENT_READ_LIMIT,
      maxChars: MAX_CHARS,
    });
  throw new Error("不支持的文档格式");
}
