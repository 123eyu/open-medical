// Seed the demo pack once the Playwright webServer is reachable.
//
// webServer is started before global setup, but waiting here keeps the setup
// robust if startup is slow (SQLite/vector-store initialization in particular).
const BASE_URL = "http://127.0.0.1:18787";
const TIMEOUT_MS = 90_000;
const DEMO_NAMES = ["示例·张沪生", "示例·李婉珍", "示例·王建国"];

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function request(path, init = {}) {
  const response = await fetch(`${BASE_URL}${path}`, {
    ...init,
    signal: AbortSignal.timeout(15_000),
    headers: { "content-type": "application/json", ...init.headers },
  });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(
      `${init.method || "GET"} ${path} -> HTTP ${response.status}: ${text}`,
    );
  }
  return text ? JSON.parse(text) : null;
}

async function waitForServer() {
  const deadline = Date.now() + TIMEOUT_MS;
  let lastError;
  while (Date.now() < deadline) {
    try {
      const health = await request("/api/agent/health");
      if (health?.ok) return;
      lastError = new Error(`unexpected health payload: ${JSON.stringify(health)}`);
    } catch (error) {
      lastError = error;
    }
    await sleep(250);
  }
  throw new Error(`E2E server did not become ready: ${lastError?.message || "timeout"}`);
}

export default async function globalSetup() {
  await waitForServer();

  const config = await request("/api/bootstrap");
  if (!config?.token) throw new Error("bootstrap did not return a session token");

  const headers = { "x-medical-token": config.token };
  const seeded = await request("/api/demo-pack", { method: "POST", headers });
  if (!seeded?.installed) throw new Error("demo pack was not installed");

  const payload = await request("/api/patients?summary=1", { headers });
  const patients = payload?.patients || [];
  if (patients.length !== 3) {
    throw new Error(`expected 3 demo patients, got ${patients.length}`);
  }
  const names = patients.map((patient) => patient.name).sort();
  if (JSON.stringify(names) !== JSON.stringify([...DEMO_NAMES].sort())) {
    throw new Error(`unexpected demo patients: ${names.join(", ")}`);
  }
}
