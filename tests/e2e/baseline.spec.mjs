import { expect, test } from "@playwright/test";

const FIXED_TIME = new Date("2026-10-28T10:00:00+08:00");
const PATIENT_NAME = "示例·张沪生";

let patientId = "";

test.beforeAll(async ({ request }) => {
  const bootstrapResponse = await request.get("/api/bootstrap");
  expect(bootstrapResponse.ok()).toBeTruthy();
  const { token } = await bootstrapResponse.json();

  const patientsResponse = await request.get("/api/patients?summary=1", {
    headers: { "x-medical-token": token },
  });
  expect(patientsResponse.ok()).toBeTruthy();
  const { patients } = await patientsResponse.json();
  expect(patients).toHaveLength(3);

  const patient = patients.find((item) => item.name === PATIENT_NAME);
  expect(patient, `${PATIENT_NAME} should be seeded`).toBeTruthy();
  patientId = patient.id;
});

async function open(page, path) {
  await page.clock.install({ time: FIXED_TIME });
  await page.goto(path, { waitUntil: "domcontentloaded" });
  await page.evaluate(() => document.fonts.ready);
}

async function capture(page, name, mask = []) {
  // Wait for all page-initiated requests (including the patient attention card
  // and demo/task lists) before freezing the layout for the frame.
  await page.waitForLoadState("networkidle");
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(250);
  await expect(page).toHaveScreenshot(name, {
    fullPage: true,
    animations: "disabled",
    caret: "hide",
    maxDiffPixelRatio: 0.01,
    mask,
  });
}

test("新建任务首页", async ({ page }) => {
  await open(page, "/?view=home");
  await expect(
    page.getByRole("heading", { name: "新任务", exact: true }),
  ).toBeVisible();
  await expect(page.getByText("个人工作空间", { exact: true })).toBeVisible();
  // The cockpit starts with em dashes and fills in after its two API calls.
  await expect(page.locator(".home-activity b").nth(0)).not.toHaveText("—");
  await expect(page.locator(".home-activity b").nth(1)).not.toHaveText("—");

  // The header date is the only wall-clock text on this page.
  await capture(page, "01-home.png", [
    page.locator(".hub-page-actions > span"),
  ]);
});

test("患者列表", async ({ page }) => {
  await open(page, "/?view=patients");
  await expect(
    page.getByRole("heading", { name: "患者管理", exact: true }),
  ).toBeVisible();
  await expect(page.getByText("3 位在管患者", { exact: true })).toBeVisible();
  await expect(page.locator(".patient-card")).toHaveCount(3);
  await expect(page.getByText(PATIENT_NAME, { exact: true })).toBeVisible();

  await capture(page, "02-patients.png");
});

test("示例·张沪生 概览", async ({ page }) => {
  await open(page, `/?view=patients&patient=${encodeURIComponent(patientId)}`);
  await expect(
    page.getByRole("heading", { name: "患者概览", exact: true }),
  ).toBeVisible();
  await expect(page.locator(".detail-head b").first()).toContainText(
    PATIENT_NAME,
  );
  await expect(page.getByText("诊断摘要", { exact: true })).toBeVisible();
  await expect(page.locator(".patient-attention")).toHaveAttribute(
    "aria-busy",
    "false",
  );

  // "更新于 hh:mm" is derived from the moment the attention card was fetched.
  await capture(page, "03-patient-overview.png", [
    page.locator(".attention-refresh"),
  ]);
});

test("示例·张沪生 诊疗辅助 tab", async ({ page }) => {
  await open(
    page,
    `/?view=patients&patient=${encodeURIComponent(patientId)}&tab=assistance`,
  );
  await expect(
    page.getByRole("heading", { name: "本次想了解什么？", exact: true }),
  ).toBeVisible();
  await expect(page.getByLabel("本次诊疗问题")).toBeVisible();

  await capture(page, "04-patient-assistance.png");
});

test("今日待办", async ({ page }) => {
  await open(page, "/?view=agenda");
  await expect(page.locator(".agenda-heading h1")).toContainText("今日待办");
  await expect(page.locator(".agenda-items .agenda-item").first()).toBeVisible();

  await capture(page, "05-agenda.png");
});

test("知识库", async ({ page }) => {
  await open(page, "/?view=knowledge");
  await expect(
    page.getByRole("heading", { name: "知识库", exact: true }),
  ).toBeVisible();
  await expect(page.getByText("示例体验资料库", { exact: true })).toBeVisible();

  await capture(page, "06-knowledge.png");
});

test("示例体验", async ({ page }) => {
  await open(page, "/?view=examples");
  await expect(
    page.getByRole("heading", { name: "示例体验", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("示例资料已就位，可以随时接着体验", { exact: true }),
  ).toBeVisible();

  await capture(page, "07-examples.png");
});

test("设置", async ({ page }) => {
  await open(page, "/?view=settings");
  await expect(
    page.getByRole("heading", { name: "设置", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "模型与运行", exact: true }),
  ).toBeVisible();

  await capture(page, "08-settings.png");
});
