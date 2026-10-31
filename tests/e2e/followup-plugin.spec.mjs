import { expect, test } from "@playwright/test";

const PATIENT_NAME = "示例·张沪生";
const CONNECTED = process.env.MEDICAL_E2E_CONNECTED === "1";
const GUIDE = "连接微信或企业微信后，可以在这里查看患者消息";
const SETTINGS_HINT = "随访计划和到期提醒可直接使用；连接微信或企业微信后才能给患者发消息";

test.describe.configure({ mode: "serial" });

async function auth(request) {
  const response = await request.get("/api/bootstrap");
  expect(response.ok()).toBeTruthy();
  const { token } = await response.json();
  return { "x-medical-token": token };
}

async function setFollowup(request, headers, enabled) {
  const response = await request.put("/api/plugins/followup", {
    headers,
    data: { enabled },
  });
  expect(response.ok()).toBeTruthy();
  return response.json();
}

async function patientUrl(request, headers) {
  const patientsResponse = await request.get("/api/patients?summary=1", {
    headers,
  });
  expect(patientsResponse.ok()).toBeTruthy();
  const { patients } = await patientsResponse.json();
  const patient = patients.find((item) => item.name === PATIENT_NAME);
  expect(patient, `${PATIENT_NAME} should be seeded`).toBeTruthy();
  return `/?view=patients&patient=${encodeURIComponent(patient.id)}`;
}

test("未连接患者渠道：随访计划和提醒可用，患者消息入口不可见", async ({
  page,
  request,
}) => {
  test.skip(CONNECTED, "connected-channel E2E run");
  const headers = await auth(request);
  await setFollowup(request, headers, true);
  const url = await patientUrl(request, headers);

  await page.goto(url, { waitUntil: "domcontentloaded" });
  await expect(
    page.getByRole("heading", { name: "患者概览", exact: true }),
  ).toBeVisible();
  const areas = page.getByRole("navigation", { name: "患者工作内容" });
  await areas.getByRole("button", { name: "沟通与随访" }).click();
  const tabs = page.getByRole("navigation", { name: "患者栏目" });
  // Chat-file import works without a live channel, so the tab stays visible.
  await expect(tabs.getByRole("button", { name: /消息记录/ })).toBeVisible();
  await expect(
    tabs.getByRole("button", { name: "随访计划", exact: true }),
  ).toBeVisible();
  await expect(
    tabs.getByRole("button", { name: "复诊预约", exact: true }),
  ).toBeVisible();

  // The follow-up page is the doctor's reminders and templates only: no
  // auto follow-up tab or connection empty state; chat import is available.
  await page.goto("/?view=followups", { waitUntil: "domcontentloaded" });
  const sections = page.getByRole("navigation", { name: "随访工作内容" });
  await expect(sections.getByRole("button", { name: "随访待办", exact: true })).toBeVisible();
  await expect(sections.getByRole("button", { name: "计划与模板", exact: true })).toBeVisible();
  await expect(sections.getByRole("button", { name: "自动随访", exact: true })).toHaveCount(0);
  await expect(sections.getByRole("button", { name: "聊天随访", exact: true })).toBeVisible();
  await expect(page.getByText(GUIDE)).toHaveCount(0);

  // Patient messages still show the connection empty state.
  await page.goto("/?view=care", { waitUntil: "domcontentloaded" });
  await expect(page.getByText(GUIDE)).toBeVisible();
  await expect(page.getByRole("button", { name: "去设置连接" })).toBeVisible();

  // Connection panels stay available, with a hint that connecting is optional.
  await page.goto("/?view=settings&settingsTab=followup", {
    waitUntil: "domcontentloaded",
  });
  await expect(
    page.getByRole("button", { name: "患者随访", exact: true }),
  ).toBeVisible();
  await expect(page.getByText(SETTINGS_HINT)).toBeVisible();
});

test("已连接渠道：患者消息/随访 tab 恢复（需 channel-fake）", async ({
  page,
  request,
}) => {
  test.skip(!CONNECTED, "requires MEDICAL_E2E_CONNECTED=1");
  const headers = await auth(request);
  await setFollowup(request, headers, true);
  const url = await patientUrl(request, headers);

  try {
    await page.goto(url, { waitUntil: "domcontentloaded" });
    await page
      .getByRole("navigation", { name: "患者工作内容" })
      .getByRole("button", { name: "沟通与随访", exact: true })
      .click();
    const tabs = page.getByRole("navigation", { name: "患者栏目" });
    await expect(tabs.getByRole("button", { name: /消息记录/ })).toBeVisible();
    await expect(
      tabs.getByRole("button", { name: "随访计划", exact: true }),
    ).toBeVisible();

    // Disabling the plugin still hides its UI while the channel remains.
    await setFollowup(request, headers, false);
    await page.reload({ waitUntil: "domcontentloaded" });
    await page
      .getByRole("navigation", { name: "患者工作内容" })
      .getByRole("button", { name: "沟通与随访", exact: true })
      .click();
    // Chat-file import works without a live channel, so the tab stays visible.
  await expect(tabs.getByRole("button", { name: /消息记录/ })).toBeVisible();
  } finally {
    await setFollowup(request, headers, true);
  }
});
