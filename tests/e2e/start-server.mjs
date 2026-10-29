// Start the production-shaped web server for Playwright.
//
// The wrapper exists for one reason: the E2E data directory must be wiped before
// the server opens SQLite. Playwright's webServer command has no separate
// "prepare" step, so the wrapper clears the directory and then launches the
// documented command as a child process, forwarding shutdown signals:
//
//   node --import ./tests/e2e/fake-time.mjs server/agent.mjs --dev-web
import { spawn } from "node:child_process";
import { mkdirSync, rmSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
const dataDir = join(root, "test-results", "e2e-data");
const tempDir = join(dataDir, "tmp");

rmSync(dataDir, { recursive: true, force: true });
mkdirSync(tempDir, { recursive: true });

const env = {
  ...process.env,
  PORT: "18787",
  TZ: "Asia/Shanghai",
  MEDICAL_DATABASE: join(dataDir, "medical.sqlite"),
  TMPDIR: tempDir,
  MEDICAL_TEST_TMP: tempDir,
};

const child = spawn(
  process.execPath,
  [
    "--import",
    join(root, "tests/e2e/fake-time.mjs"),
    join(root, "server/agent.mjs"),
    "--dev-web",
  ],
  { cwd: root, env, stdio: "inherit" },
);

let stopping = false;
function stop(signal = "SIGTERM") {
  if (stopping) return;
  stopping = true;
  child.kill(signal);
  setTimeout(() => child.kill("SIGKILL"), 15000);
}

process.once("SIGINT", () => stop("SIGINT"));
process.once("SIGTERM", () => stop("SIGTERM"));
process.once("exit", () => {
  if (child.exitCode === null) child.kill("SIGKILL");
});

child.once("error", (error) => {
  console.error(`[e2e] failed to start server: ${error.stack || error}`);
  process.exit(1);
});
child.once("exit", (code, signal) => {
  if (signal) console.error(`[e2e] server stopped by ${signal}`);
  process.exit(stopping ? 0 : code ?? (signal ? 1 : 0));
});
