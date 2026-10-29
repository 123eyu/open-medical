import { cp, mkdir, rm } from "node:fs/promises";
import { join, relative, sep } from "node:path";
import { excludedPluginPath, prohibited } from "./desktop-candidate.mjs";

// Every runtime assembly script must share this list. The packaged app boots
// server/agent.mjs, which resolves plugins relative to its own directory; if
// plugins/ is not staged, the UI and tests still work from source but every
// domain plugin disappears from the installed desktop app.
export const desktopRuntimeEntries = Object.freeze([
  "dist",
  "desktop",
  "shared",
  "skills",
  "integrations",
  "examples",
  "build/icons",
  "server",
  "plugins",
]);

export const desktopRuntimeScripts = Object.freeze([
  "workspace-cli.mjs",
  "backup.mjs",
  "agent-daemon.mjs",
  "daemon-supervisor.mjs",
  "local-transcription.py",
]);

export const updateRuntimeEntries = Object.freeze([
  "dist",
  "desktop",
  "shared",
  "skills",
  "integrations",
  "examples",
  "server",
  "plugins",
]);

export const updateRuntimeScripts = Object.freeze([
  ...desktopRuntimeScripts,
  "remote-coordinator.mjs",
  "remote-worker.mjs",
]);

export { excludedPluginPath };

export function pluginFileAllowed(root, source) {
  const path = relative(join(root, "plugins"), source).split(sep).join("/");
  // The plugins directory itself (and anything outside it) is not a candidate
  // for filtering; individual plugin files are.
  if (!path || path === ".." || path.startsWith("../")) return true;
  return !excludedPluginPath(path);
}

export function safeRuntimeSource(root, source) {
  const name = relative(root, source).split(sep).join("/");
  return (
    !prohibited(name) &&
    name !== "server/data" &&
    !name.startsWith("server/data/")
  );
}

export async function stageRuntime({
  root,
  target,
  entries = desktopRuntimeEntries,
  scripts = desktopRuntimeScripts,
  clean = false,
  filter = (source) => safeRuntimeSource(root, source),
}) {
  for (const entry of entries) {
    const destination = join(target, entry);
    if (clean) await rm(destination, { recursive: true, force: true });
    const entryFilter =
      entry === "plugins"
        ? (source) => filter(source) && pluginFileAllowed(root, source)
        : filter;
    await cp(join(root, entry), destination, {
      recursive: true,
      filter: entryFilter,
    });
  }
  if (clean) await rm(join(target, ".env.example"), { force: true });
  await cp(join(root, ".env.example"), join(target, ".env.example"));
  if (clean) await rm(join(target, "scripts"), { recursive: true, force: true });
  await mkdir(join(target, "scripts"), { recursive: true });
  for (const script of scripts)
    await cp(join(root, "scripts", script), join(target, "scripts", script));
}
