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

const MAX_SCREENSHOT_HEIGHT = 4000;

// The app shell is a fixed 100dvh frame with an internal scroll area, so
// fullPage alone only captures the first viewport. Grow the viewport until the
// page's own scroller has no overflow; width stays 1440.
async function expandMainContent(page, selector) {
  const scroller = page.locator(selector).first();
  await expect(scroller).toBeVisible();

  for (let attempt = 0; attempt < 4; attempt += 1) {
    const { scrollHeight, clientHeight } = await scroller.evaluate((element) => ({
      scrollHeight: element.scrollHeight,
      clientHeight: element.clientHeight,
    }));
    if (scrollHeight <= clientHeight + 1) break;

    const viewport = page.viewportSize();
    const height = Math.min(
      MAX_SCREENSHOT_HEIGHT,
      viewport.height + (scrollHeight - clientHeight) + 32,
    );
    if (height <= viewport.height) break;
    await page.setViewportSize({ width: viewport.width, height });
    await page.waitForTimeout(100);
  }

  await scroller.evaluate((element) => { element.scrollTop = 0; });
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.evaluate(() => document.fonts.ready);
}

async function capture(page, name, { scroll, mask = [] } = {}) {
  // Wait for all page-initiated requests (including the patient attention card
  // and demo/task lists) before freezing the layout for the frame.
  await page.waitForLoadState("networkidle");
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(250);
  if (scroll) await expandMainContent(page, scroll);
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
  await capture(page, "01-home.png", {
    scroll: ".workbench-hub",
    mask: [page.locator(".hub-page-actions > span")],
  });
});

test("患者列表", async ({ page }) => {
  await open(page, "/?view=patients");
  await expect(
    page.getByRole("heading", { name: "患者管理", exact: true }),
  ).toBeVisible();
  await expect(page.getByText("3 位在管患者", { exact: true })).toBeVisible();
  await expect(page.locator(".patient-card")).toHaveCount(3);
  await expect(page.getByText(PATIENT_NAME, { exact: true })).toBeVisible();

  await capture(page, "02-patients.png", {
    scroll: ".patients-view",
  });
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

  // Only the hh:mm inside "更新于 hh:mm" is wall-clock dependent; the refresh
  // button and the list of tasks below it must stay part of the comparison.
  await capture(page, "03-patient-overview.png", {
    scroll: ".patients-view",
    mask: [page.locator(".attention-refresh time")],
  });
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

  await capture(page, "04-patient-assistance.png", {
    scroll: ".patients-view",
  });
});

test("今日待办", async ({ page }) => {
  await open(page, "/?view=agenda");
  await expect(page.locator(".agenda-heading h1")).toContainText("今日待办");
  await expect(page.locator(".agenda-items .agenda-item").first()).toBeVisible();

  await capture(page, "05-agenda.png", {
    scroll: ".work-directory.agenda-page",
  });
});

test("知识库", async ({ page }) => {
  await open(page, "/?view=knowledge");
  await expect(
    page.getByRole("heading", { name: "知识库", exact: true }),
  ).toBeVisible();
  await expect(page.getByText("示例体验资料库", { exact: true })).toBeVisible();

  await capture(page, "06-knowledge.png", {
    scroll: ".module-view.library-hub",
  });
});

test("示例体验", async ({ page }) => {
  await open(page, "/?view=examples");
  await expect(
    page.getByRole("heading", { name: "示例体验", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("示例资料已就位，可以随时接着体验", { exact: true }),
  ).toBeVisible();

  await capture(page, "07-examples.png", {
    scroll: ".demo-experience.work-directory",
  });
});

test("设置", async ({ page }) => {
  await open(page, "/?view=settings");
  await expect(
    page.getByRole("heading", { name: "设置", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "模型与运行", exact: true }),
  ).toBeVisible();

  await capture(page, "08-settings.png", {
    scroll: ".app-settings-page",
  });
});
