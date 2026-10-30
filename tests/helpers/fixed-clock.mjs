// Deterministic wall clock for snapshot tests.
//
// The demo pack derives every date from Date.now(), so route snapshots that
// contain demo dates (today's visit, "16 days ago" labs) drift as real days
// pass. Import this module FIRST in such a test file: each node:test file runs
// in its own process, so the patch never leaks into other tests. Time still
// advances from the fixed instant, so timers and ordering keep working.
//
// The instant matches the moment the committed snapshots were recorded.
export const FIXED_SNAPSHOT_TIME = "2026-10-29T09:00:00+08:00";

process.env.TZ = "Asia/Shanghai";

const RealDate = globalThis.Date;
const start = RealDate.parse(process.env.MEDICAL_TEST_NOW || FIXED_SNAPSHOT_TIME);
const startedAt = RealDate.now();
const now = () => start + (RealDate.now() - startedAt);

function FixedDate(...args) {
  if (!new.target) return new RealDate(now()).toString();
  return args.length === 0 ? new RealDate(now()) : new RealDate(...args);
}
Object.setPrototypeOf(FixedDate, RealDate);
FixedDate.prototype = RealDate.prototype;
FixedDate.now = now;
FixedDate.parse = RealDate.parse;
FixedDate.UTC = RealDate.UTC;
globalThis.Date = FixedDate;
