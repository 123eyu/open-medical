import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { runCycles, validateReport } from "../scripts/agent-review-cycle.mjs";

const review = () => ({ summary: "synthetic controller test", journeys: ["fixture journey"], evidenceFiles: ["fixture evidence"], questions: Array.from({ length: 100 }, (_, i) => ({ id: `Q${i + 1}`, question: `Question ${i + 1}?`, observation: "fixture", kind: "observed", priority: "P2", acceptance: "fixture expectation" })), focusIds: ["Q1"] });
const optimize = () => ({ summary: "fixture fix", dispositions: review().questions.map(q => ({ id: q.id, action: q.id === "Q1" ? "fixed" : "deferred", detail: "fixture" })), changedFiles: [], tests: ["fixture"], limitations: [] });
test("review cycles reject missing questions, duplicate dispositions and unverified acceptance", () => {
  const r = review(); validateReport("review", r);
  assert.throws(() => validateReport("review", { ...r, questions: r.questions.slice(1) }));
  const o = optimize(); validateReport("optimize", o, r);
  assert.throws(() => validateReport("optimize", { ...o, dispositions: [...o.dispositions.slice(1), o.dispositions[1]] }, r));
  assert.throws(() => validateReport("accept", { accepted: true, summary: "", checks: [], journeys: ["fixture"], evidenceFiles: ["fixture"], blockers: [], remaining: [] }, r, o));
});

test("cycles resume the original reviewer, repair rejections, retry publish and stop at the configured count", async t => {
  const cwd = await mkdtemp(join(tmpdir(), "review-cycle-")); t.after(() => rm(cwd, { recursive: true, force: true }));
  await writeFile(join(cwd, ".gitignore"), "output/\n");
  await writeFile(join(cwd, "fake-agent.mjs"), `
import {writeFileSync,appendFileSync} from 'node:fs';
import {basename,dirname,join} from 'node:path';
const args=process.argv.slice(2), output=args[args.indexOf('--output-last-message')+1];
const stage=basename(output).split('-')[0], round=basename(dirname(output));
const session=args.includes('resume')?args.at(-2):stage+'-'+round;
appendFileSync(join(process.cwd(),'output/calls.jsonl'),JSON.stringify({stage,session,round})+'\\n');
console.log(JSON.stringify({type:'thread.started',thread_id:session}));
const review=${JSON.stringify(review())}, optimize=${JSON.stringify(optimize())};
const accepted=!output.endsWith('accept-1.json');
const accept={accepted,summary:'fixture',checks:[{id:'Q1',passed:accepted,evidence:'fixture'}],journeys:['fixture'],evidenceFiles:['fixture'],blockers:accepted?[]:['fixture rejection'],remaining:[]};
writeFileSync(output,JSON.stringify(stage==='review'?review:stage==='optimize'?optimize:accept));
`);
  await writeFile(join(cwd, "publish.mjs"), `
import {existsSync,writeFileSync,appendFileSync} from 'node:fs';
if(!existsSync('output/publish-attempted')){writeFileSync('output/publish-attempted','1');process.exit(1);}
appendFileSync('output/published',process.env.REVIEW_ROUND+'\\n');
`);
  const git = args => execFileSync("git", args, { cwd, stdio: "pipe" });
  git(["init", "-q"]); git(["add", "."]); git(["-c", "user.name=Test", "-c", "user.email=test@example.invalid", "commit", "-qm", "fixture"]);
  const config = { cwd, output: "output", rounds: 2, agent: [process.execPath, join(cwd, "fake-agent.mjs")], publish: [process.execPath, join(cwd, "publish.mjs")], common: "fixture", prompts: { review: "fixture", optimize: "fixture", accept: "fixture" } };
  await assert.rejects(runCycles(config), /Command exited 1/);
  const stopped = JSON.parse(await readFile(join(cwd, "output/state.json"), "utf8"));
  assert.equal(stopped.rounds[0].stage, "publish");
  const state = await runCycles(config, { resume: true });
  assert.equal(state.rounds.length, 2); assert.ok(state.rounds.every(r => r.stage === "done" && r.repairs === 1));
  const calls = (await readFile(join(cwd, "output/calls.jsonl"), "utf8")).trim().split("\n").map(JSON.parse);
  assert.equal(calls.length, 10);
  for (const round of ["round-1", "round-2"]) {
    const reviewer = calls.find(c => c.round === round && c.stage === "review").session;
    assert.ok(calls.filter(c => c.round === round && c.stage === "accept").every(c => c.session === reviewer));
  }
  assert.equal(await readFile(join(cwd, "output/published"), "utf8"), "1\n2\n");
  await runCycles(config, { resume: true });
  assert.equal((await readFile(join(cwd, "output/calls.jsonl"), "utf8")).trim().split("\n").length, 10);
});
