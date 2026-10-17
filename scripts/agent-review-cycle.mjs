import { spawn, execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile, writeFile, mkdir, open, rm, lstat, readlink } from "node:fs/promises";
import { resolve, join } from "node:path";
import { pathToFileURL } from "node:url";
import Ajv from "ajv";

const string = { type: "string" };
const strings = { type: "array", items: string };
const object = (properties) => ({ type: "object", properties, required: Object.keys(properties), additionalProperties: false });
const list = (items) => ({ type: "array", items });
export const schemas = {
  review: object({
    summary: string, journeys: strings, evidenceFiles: strings,
    questions: { ...list(object({ id: string, question: string, observation: string, kind: { enum: ["observed", "code", "hypothesis", "supported"] }, priority: { enum: ["P0", "P1", "P2", "P3"] }, acceptance: string })), minItems: 100, maxItems: 100 },
    focusIds: strings,
  }),
  optimize: object({
    summary: string,
    dispositions: list(object({ id: string, action: { enum: ["fixed", "deferred", "not_issue", "unverified"] }, detail: string })),
    changedFiles: strings, tests: strings, limitations: strings,
  }),
  accept: object({
    accepted: { type: "boolean" }, summary: string,
    checks: list(object({ id: string, passed: { type: "boolean" }, evidence: string })),
    journeys: strings, evidenceFiles: strings, blockers: strings, remaining: strings,
  }),
};
const validators = Object.fromEntries(Object.entries(schemas).map(([key, value]) => [key, new Ajv({ strict: false }).compile(value)]));
export function validateReport(stage, report, review, optimization) {
  if (!validators[stage](report)) throw new Error(`${stage}: invalid report: ${JSON.stringify(validators[stage].errors)}`);
  if (stage === "review") {
    const ids = new Set(report.questions.map(q => q.id));
    if (ids.size !== 100 || new Set(report.questions.map(q => q.question.trim())).size !== 100) throw new Error("Review needs 100 distinct questions and IDs");
    if (!report.journeys.length || !report.evidenceFiles.length) throw new Error("Review needs actual journey evidence");
    if (!report.focusIds.length || report.focusIds.some(id => !ids.has(id))) throw new Error("Invalid focus IDs");
  }
  if (stage === "optimize") {
    const ids = new Set(review.questions.map(q => q.id));
    if (report.dispositions.length !== ids.size || new Set(report.dispositions.map(q => q.id)).size !== ids.size || report.dispositions.some(q => !ids.has(q.id))) throw new Error("Every question needs exactly one disposition");
  }
  if (stage === "accept") {
    const fixed = optimization.dispositions.filter(q => q.action === "fixed").map(q => q.id);
    if (new Set(report.checks.map(q => q.id)).size !== report.checks.length) throw new Error("Duplicate acceptance IDs");
    if (fixed.some(id => !report.checks.some(c => c.id === id))) throw new Error("Acceptance must check every claimed fix");
    if (report.accepted && (report.blockers.length || report.checks.some(c => !c.passed) || !report.journeys.length || !report.evidenceFiles.length)) throw new Error("Accepted report has failures or missing evidence");
  }
  return report;
}

export async function sourceFingerprint(root) {
  const names = [...new Set(execFileSync("git", ["ls-files", "-co", "--exclude-standard", "-z"], { cwd: root, encoding: "utf8" }).split("\0").filter(Boolean))].sort();
  const hash = createHash("sha256");
  hash.update(execFileSync("git", ["rev-parse", "HEAD"], { cwd: root }));
  for (const name of names) {
    hash.update(name).update("\0");
    try { const path = join(root, name), stat = await lstat(path); hash.update(stat.isSymbolicLink() ? await readlink(path) : await readFile(path)); }
    catch (error) { if (error.code !== "ENOENT") throw error; hash.update("<deleted>"); }
  }
  return hash.digest("hex");
}

const atomicJson = async (path, value) => {
  const { rename } = await import("node:fs/promises");
  await writeFile(path + ".tmp", JSON.stringify(value, null, 2) + "\n");
  await rename(path + ".tmp", path);
};
const readJson = async path => JSON.parse(await readFile(path, "utf8"));

export async function runCycles(config, { resume = false } = {}) {
  const root = resolve(config.cwd || process.cwd()), directory = resolve(root, config.output);
  if (!Number.isInteger(config.rounds) || config.rounds < 1) throw new Error("Positive round count required");
  if (!Array.isArray(config.publish) || !config.publish.length) throw new Error("A publish command is required");
  await mkdir(directory, { recursive: true });
  const lockPath = join(directory, "runner.lock");
  try { const lock = await open(lockPath, "wx"); await lock.writeFile(String(process.pid)); await lock.close(); }
  catch (error) { if (error.code !== "EEXIST") throw error; throw new Error("Runner lock exists; check its PID before removing a stale lock"); }
  const statePath = join(directory, "state.json");
  const signature = createHash("sha256").update(JSON.stringify(config)).digest("hex");
  let child;
  const stop = () => { if (child) child.kill("SIGINT"); };
  process.on("SIGINT", stop); process.on("SIGTERM", stop);
  try {
    let state;
    try { state = await readJson(statePath); if (!resume) throw new Error("Existing state requires --resume"); }
    catch (error) { if (error.code !== "ENOENT") throw error; state = { signature, rounds: [], startedAt: new Date().toISOString() }; }
    if (state.signature !== signature) throw new Error("Configuration changed since checkpoint");
    const save = () => atomicJson(statePath, state);
    const event = (type, data = {}) => console.log(JSON.stringify({ at: new Date().toISOString(), type, ...data }));
    async function command(args, options = {}) {
      const { log, input, onLine } = options;
      const handle = await open(log, "a");
      try {
        await new Promise((ok, fail) => {
          child = spawn(args[0], args.slice(1), { cwd: root, env: { ...process.env, ...(options.env || {}) }, stdio: ["pipe", "pipe", "pipe"] });
          let pending = "", settled = false;
          const finish = error => { if (settled) return; settled = true; child = null; error ? fail(error) : ok(); };
          child.stdout.on("data", bytes => { handle.write(bytes).catch(fail); pending += bytes.toString(); let at; while ((at = pending.indexOf("\n")) >= 0) { const line = pending.slice(0, at); pending = pending.slice(at + 1); onLine?.(line); } });
          child.stderr.on("data", bytes => { handle.write(bytes).catch(fail); });
          child.on("error", finish);
          child.on("close", (code, signal) => finish(code === 0 ? null : new Error(`Command exited ${code ?? signal}; see ${log}`)));
          child.stdin.on("error", () => {}); child.stdin.end(input || "");
        });
      } finally { await handle.close(); }
    }
    for (let number = 1; number <= config.rounds; number++) {
      const record = state.rounds[number - 1] ||= { number, stage: "review", sessions: {}, attempts: {} };
      if (record.stage === "done") continue;
      const roundDir = join(directory, `round-${number}`); await mkdir(roundDir, { recursive: true });
      const reportPath = stage => join(roundDir, `${stage}.json`);
      await save();
      async function agent(stage, extra = "") {
        const owner = stage === "accept" ? "review" : stage;
        if (stage === "accept" && !record.sessions.review) throw new Error("Original reviewer session is missing");
        const attempt = record.attempts[stage] = (record.attempts[stage] || 0) + 1;
        const stem = join(roundDir, `${stage}-${attempt}`);
        const schemaPath = stem + ".schema.json", outputPath = stem + ".json";
        await atomicJson(schemaPath, schemas[stage]);
        const prompt = [config.common, `当前第 ${number}/${config.rounds} 轮。重点：${config.focus?.[number - 1] || "完整用户动线"}。`, `本轮目录：${roundDir}。前轮记录位于：${directory}。`, config.prompts[stage], `本轮评审：${reportPath("review")}；优化结果：${reportPath("optimize")}。`, extra].join("\n\n");
        await writeFile(stem + ".prompt.txt", prompt);
        const before = stage === "optimize" ? null : await sourceFingerprint(root);
        record.active = { stage, attempt, startedAt: new Date().toISOString() }; await save(); event("agent.started", { round: number, stage, attempt, session: record.sessions[owner] || null });
        const args = [...(config.agent || ["codex"]), "-a", "never", "-s", "danger-full-access", "exec"];
        if (record.sessions[owner]) args.push("resume");
        args.push("--json", "--output-schema", schemaPath, "--output-last-message", outputPath);
        if (record.sessions[owner]) args.push(record.sessions[owner]);
        args.push("-");
        let foundSession;
        try {
          await command(args, { log: stem + ".jsonl", input: prompt, onLine: line => { try { const e = JSON.parse(line); if (e.type === "thread.started") foundSession = e.thread_id; } catch { /* stderr can share the log */ } } });
        } finally {
          if (foundSession && (!record.sessions[owner] || record.sessions[owner] === foundSession)) { record.sessions[owner] = foundSession; await save(); }
        }
        if (!foundSession) throw new Error("Agent did not return a session ID");
        if (record.sessions[owner] && record.sessions[owner] !== foundSession) throw new Error("Agent session unexpectedly changed");
        record.sessions[owner] = foundSession; await save();
        if (before && await sourceFingerprint(root) !== before) throw new Error(`${stage} changed source files; independent review stopped`);
        const report = await readJson(outputPath);
        validateReport(stage, report, stage !== "review" ? await readJson(reportPath("review")) : null, stage === "accept" ? await readJson(reportPath("optimize")) : null);
        await atomicJson(reportPath(stage), report); record.active = null; await save(); event("agent.completed", { round: number, stage, session: foundSession });
        return report;
      }
      if (record.stage === "review") { await agent("review"); record.stage = "optimize"; await save(); }
      while (["optimize", "accept"].includes(record.stage)) {
        if (record.stage === "optimize") { await agent("optimize", record.rejection ? `上一验收未通过：${JSON.stringify(record.rejection)}。请修复，不得降低验收标准。` : ""); record.stage = "accept"; await save(); }
        const result = await agent("accept");
        if (result.accepted) { record.stage = "publish"; record.acceptedFingerprint = await sourceFingerprint(root); await save(); break; }
        record.rejection = result; record.repairs = (record.repairs || 0) + 1; record.stage = "optimize"; await save();
        if (record.repairs >= (config.maxRepairs || 3)) throw new Error(`Round ${number} still rejected after ${record.repairs} repairs; checkpoint retained`);
      }
      if (record.stage === "publish") {
        event("publish.started", { round: number });
        await command(config.publish, { log: join(roundDir, "publish.log"), env: { REVIEW_ROUND: String(number), REVIEW_ROUND_DIR: roundDir, REVIEW_ACCEPTED_FINGERPRINT: record.acceptedFingerprint } });
        record.stage = "done"; record.completedAt = new Date().toISOString(); await save(); event("round.completed", { round: number });
      }
    }
    state.completedAt = new Date().toISOString(); await save(); event("complete", { rounds: config.rounds }); return state;
  } finally { process.removeListener("SIGINT", stop); process.removeListener("SIGTERM", stop); await rm(lockPath, { force: true }); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const path = process.argv.find((arg, index) => index > 1 && !arg.startsWith("--"));
  if (!path) throw new Error("Usage: node scripts/agent-review-cycle.mjs CONFIG.json [--resume]");
  await runCycles(await readJson(resolve(path)), { resume: process.argv.includes("--resume") });
}
