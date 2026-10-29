// Server-side clock for deterministic E2E fixtures.
//
// The demo pack derives every date from Date.now(), so the E2E server starts at
// a fixed wall-clock instant. Time still advances normally from that instant:
// timers, polling and follow-up scheduling keep working, while the generated
// dates remain identical across runs.
//
// Usage: node --import ./tests/e2e/fake-time.mjs server/agent.mjs --dev-web
const FIXED_START = Date.parse("2026-10-28T10:00:00+08:00");
const RealDate = globalThis.Date;
const startedAt = RealDate.now();

// The UI is configured with Asia/Shanghai and the demo pack uses local calendar
// dates, so keep the server calendar in the same zone when the host allows it.
process.env.TZ = "Asia/Shanghai";

function now() {
  return FIXED_START + (RealDate.now() - startedAt);
}

function FakeDate(...args) {
  if (!new.target) return new RealDate(now()).toString();
  return args.length === 0 ? new RealDate(now()) : new RealDate(...args);
}

Object.setPrototypeOf(FakeDate, RealDate);
FakeDate.prototype = RealDate.prototype;
FakeDate.now = now;
FakeDate.parse = RealDate.parse;
FakeDate.UTC = RealDate.UTC;

globalThis.Date = FakeDate;
