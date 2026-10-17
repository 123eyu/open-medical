import { execFile } from "node:child_process";
import { lstat, readFile, readdir, realpath, rm } from "node:fs/promises";
import { join, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";

const exec = promisify(execFile);
const hour = 60 * 60 * 1000;

async function openFiles() {
  if (process.platform !== "darwin")
    throw new Error("Open-file inspection requires macOS");
  const { stdout } = await exec("/usr/sbin/lsof", ["-n", "-P", "-F", "n"], {
    maxBuffer: 32 * 1024 * 1024,
  });
  return stdout
    .split("\n")
    .filter((line) => line.startsWith("n"))
    .map((line) => line.slice(1));
}

async function exists(path) {
  try {
    return await lstat(path);
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
}

// Only developer rollback bundles are eligible. Candidate builds, media,
// installed applications and databases are outside this command's scope.
async function discover(output) {
  const result = [];
  async function walk(directory) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      if (!entry.isDirectory() || entry.isSymbolicLink()) continue;
      const path = join(directory, entry.name);
      if (entry.name.endsWith(".app")) {
        if (
          !/^previous(?:[-.]).*\.app$/.test(entry.name) &&
          entry.name !== "previous.app"
        )
          continue;
        const resources = join(path, "Contents/Resources/app");
        let pkg;
        try {
          pkg = JSON.parse(
            await readFile(join(resources, "package.json"), "utf8"),
          );
        } catch (error) {
          if (error.code === "ENOENT" || error instanceof SyntaxError) continue;
          throw error;
        }
        if (
          pkg.name !== "open-medical-desktop" ||
          !/^\d+\.\d+\.\d+$/.test(pkg.version || "")
        )
          continue;
        if (!(await exists(join(path, "Contents/MacOS/Open Medical"))))
          continue;
        // Treat even an empty data directory as user state: never infer it is disposable.
        let hasState = false;
        for (const name of [
          "server/data",
          ".env",
          "model.env",
          "credentials.key",
        ])
          if (await exists(join(resources, name))) hasState = true;
        if (hasState) continue;
        const stat = await lstat(path);
        result.push({
          path,
          version: pkg.version,
          inode: stat.ino,
          device: stat.dev,
          changed: stat.ctimeMs,
        });
      } else if (!["node_modules", ".git"].includes(entry.name))
        await walk(path);
    }
  }
  const stat = await exists(output);
  if (!stat) return result;
  if (stat.isSymbolicLink() || !stat.isDirectory())
    throw new Error("Output must be a real directory");
  await walk(output);
  return result;
}

function newest(a, b) {
  const left = a.version.split(".").map(Number),
    right = b.version.split(".").map(Number);
  for (let i = 0; i < 3; i++)
    if (left[i] !== right[i]) return right[i] - left[i];
  return b.changed - a.changed || a.path.localeCompare(b.path);
}

export async function pruneDesktopBackups({
  root = resolve(import.meta.dirname, ".."),
  apply = false,
  keep = 1,
  now = Date.now(),
  minAgeMs = hour,
  getOpenFiles = openFiles,
} = {}) {
  if (!Number.isInteger(keep) || keep < 1)
    throw new Error("Keep at least one rollback bundle");
  root = await realpath(root);
  const output = join(root, "output");
  const candidates = (await discover(output)).sort(newest);
  const retained = candidates.slice(0, keep).map((entry) => entry.path);
  const eligible = [],
    protectedPaths = [];
  for (const entry of candidates.slice(keep)) {
    if (now - entry.changed < minAgeMs) protectedPaths.push(entry.path);
    else eligible.push(entry);
  }
  const result = {
    applied: apply,
    retained,
    protected: protectedPaths,
    removable: eligible.map((entry) => entry.path),
    removed: [],
  };
  if (!apply || !eligible.length) return result;
  // A failed process inspection must never turn into permission to delete.
  const open = await Promise.all(
    (await getOpenFiles()).map(async (path) => {
      try {
        return await realpath(path);
      } catch {
        return path;
      }
    }),
  );
  for (const entry of eligible) {
    if (
      open.some(
        (path) => path === entry.path || path.startsWith(entry.path + sep),
      )
    ) {
      result.protected.push(entry.path);
      continue;
    }
    const stat = await lstat(entry.path);
    if (
      stat.isSymbolicLink() ||
      stat.ino !== entry.inode ||
      stat.dev !== entry.device ||
      stat.ctimeMs !== entry.changed ||
      (await realpath(entry.path)) !== entry.path
    )
      throw new Error("Backup changed during cleanup: " + entry.path);
    await rm(entry.path, { recursive: true });
    result.removed.push(entry.path);
  }
  return result;
}

export async function pruneAfterDesktopBuild(root) {
  if (process.platform !== "darwin") return;
  try {
    const result = await pruneDesktopBackups({ root, apply: true });
    if (result.removed.length)
      console.log(
        `Removed ${result.removed.length} old desktop rollback bundles; newest backup retained.`,
      );
  } catch (error) {
    // Housekeeping must not turn a successful build into a failed release.
    console.warn("Desktop backup cleanup skipped: " + error.message);
  }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  const args = process.argv.slice(2);
  if (args.some((arg) => arg !== "--apply" && !/^--keep=\d+$/.test(arg)))
    throw new Error("Usage: npm run desktop:prune -- [--apply] [--keep=1]");
  const keep = Number(
    args.find((arg) => arg.startsWith("--keep="))?.slice(7) ?? 1,
  );
  console.log(
    JSON.stringify(
      await pruneDesktopBackups({ apply: args.includes("--apply"), keep }),
      null,
      2,
    ),
  );
}
