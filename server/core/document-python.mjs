// Local document environment: generates PPTX/DOCX/XLSX/PDF without Docker.
//
// Same model as the research environment (research-python.mjs): a venv under
// <dataDir>/document-python, installed only when the user clicks install, and
// every run goes through the OS sandbox (macOS Seatbelt / Windows AppContainer):
// no network, no child processes, writes only inside a per-run temp folder.
// The code that runs is the fixed document script shared with the Docker
// runtime (desktop/full-runtime); the model only supplies JSON content.
import { copyFileSync, mkdirSync, realpathSync, writeFileSync } from "node:fs";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { AppError, check } from "../errors.mjs";
import { ResearchPython } from "./research-python.mjs";
import { runSeatbelt } from "./python-sandbox.mjs";

export const DOCUMENT_PACKAGES = [
  "python-pptx>=0.6.21",
  "python-docx>=1.1",
  "openpyxl>=3.1",
  "reportlab>=4.0",
  "pypdf>=4.0",
  "pillow>=10.0",
];
const DOCUMENT_MODULES = ["pptx", "docx", "openpyxl", "reportlab", "pypdf", "PIL"];
const TOOLS = join(dirname(fileURLToPath(import.meta.url)), "../../desktop/full-runtime");
const OUTPUT_LIMIT = 10_000_000;
const INPUT_LIMIT = 10_000_000;

// argv: request.json result.json [site-packages...] (site dirs only on Windows).
const WRAPPER = String.raw`import sys,os,json
if os.name!="nt":
    import resource
    resource.setrlimit(resource.RLIMIT_FSIZE,(20000000,20000000))
    resource.setrlimit(resource.RLIMIT_CORE,(0,0))
# openpyxl builds a MimeTypes table at import; keep it off system files the
# sandbox does not grant (e.g. /etc/apache2/mime.types).
import mimetypes
mimetypes.knownfiles[:]=[]
import site
for p in sys.argv[3:]: site.addsitedir(p)
with open(sys.argv[1],encoding="utf-8") as f: request=json.load(f)
sys.path.insert(0,request["tools"])
os.chdir(request["cwd"])
from document import create_document, safe_path
result=create_document(safe_path(request["path"]),request["content"])
with open(sys.argv[2],"w",encoding="utf-8") as f: json.dump({"result":result},f,ensure_ascii=False,default=str)
`;

const inside = (root, path) => {
  const target = resolve(root, path);
  return target.startsWith(root + sep) ? target : null;
};

export class DocumentPython extends ResearchPython {
  constructor(options = {}) {
    super({
      python: process.env.MEDICAL_DOCUMENT_PYTHON,
      timeoutMs: 90000,
      memoryMb: 1024,
      ...options,
      dirName: "document-python",
      packages: DOCUMENT_PACKAGES,
      modules: DOCUMENT_MODULES,
      label: "文档生成环境",
      installHint: "约 70MB",
    });
  }

  // Ready means installed on a supported host; used by tool readiness.
  ready() {
    return this.supported() && Boolean(this.interpreter());
  }

  status() {
    return {
      ...super.status(),
      limits: { timeoutMs: this.timeoutMs, memoryMb: this.memoryMb, network: false, childProcesses: false, writes: "仅本次生成的临时目录" },
    };
  }

  // content: the document JSON; inputs: [{ name, data }] images referenced by
  // relative path. Returns the generated file's bytes.
  async create({ path, content, inputs = [], signal }) {
    check(/\.(pdf|docx|xlsx|pptx)$/i.test(path || ""), "DOCUMENT_FORMAT", "生成格式须为 PDF/DOCX/XLSX/PPTX");
    const env = await this.probe();
    check(this.active < this.maxActive, "SANDBOX_CAPACITY", "正在生成其他文档，请稍后", 429);
    check(inputs.reduce((n, item) => n + item.data.length, 0) <= INPUT_LIMIT, "SNAPSHOT_LIMIT", "文档输入图片超过 10MB");
    signal?.throwIfAborted();
    this.active++;
    let workdir;
    try {
      workdir = realpathSync(await mkdtemp(join(tmpdir(), "document-sandbox-")));
      const tools = join(workdir, "tools"),
        cwd = join(workdir, "work");
      mkdirSync(tools);
      mkdirSync(cwd);
      for (const name of ["document.py", "document_layout.py"]) copyFileSync(join(TOOLS, name), join(tools, name));
      writeFileSync(join(tools, "run.py"), WRAPPER);
      check(inside(cwd, path), "PATH_DENIED", "只能使用相对路径", 403);
      for (const item of inputs) {
        const target = inside(cwd, item.name);
        check(target, "PATH_DENIED", "输入文件路径无效", 403);
        mkdirSync(dirname(target), { recursive: true });
        await writeFile(target, item.data);
      }
      const files = { input: join(workdir, "request.json"), output: join(workdir, "result.json") };
      writeFileSync(files.input, JSON.stringify({ tools, cwd, path, content }));
      const script = [join(tools, "run.py"), files.input, files.output];
      if (process.platform === "win32") await this.launchWindows(env, workdir, script, signal);
      else
        await runSeatbelt({
          profile: this.profile(workdir),
          argv: [env.launcher, "-I", "-B", ...script],
          cwd,
          env: { LANG: "en_US.UTF-8", TMPDIR: workdir, HOME: workdir },
          timeoutMs: this.timeoutMs,
          maxOutput: 1_000_000,
          memoryKb: this.memoryMb * 1024,
          signal,
        });
      const output = inside(cwd, path);
      let info;
      try {
        info = await stat(output);
      } catch {
        throw new AppError("SANDBOX_RESULT", "文档没有生成（沙箱进程可能被时间或内存限制终止）", 422);
      }
      check(info.isFile() && info.size <= OUTPUT_LIMIT, "FILE_LIMIT", "生成的文档超过 10MB");
      return { path: relative(cwd, output).split(sep).join("/"), data: await readFile(output) };
    } finally {
      if (workdir) await rm(workdir, { recursive: true, force: true });
      this.active--;
    }
  }

  async selfTest() {
    const result = await this.create({
      path: "check.pptx",
      content: { slides: [{ title: "环境检查", paragraphs: ["ok"] }] },
    });
    check(result.data.length > 0, "SANDBOX_RESULT", "文档环境自检失败", 500);
  }
}
