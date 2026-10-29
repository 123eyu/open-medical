import { expect, test } from "@playwright/test";

const PATIENT_NAME = "示例·张沪生";
const CONNECTED = process.env.MEDICAL_E2E_CONNECTED === "1";
const GUIDE = "连接微信或企业微信后，即可使用随访与患者消息";
const SETTINGS_HINT = "连接微信或企业微信后启用随访与患者消息";

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

test("未连接渠道：随访入口不可见，设置页保留连接引导", async ({
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
  await expect(tabs.getByRole("button", { name: /消息记录/ })).toHaveCount(0);
  await expect(
    tabs.getByRole("button", { name: "随访计划", exact: true }),
  ).toHaveCount(0);
  await expect(
    tabs.getByRole("button", { name: "复诊预约", exact: true }),
  ).toBeVisible();
  await expect(
    tabs.getByRole("button", { name: "检查与转诊", exact: true }),
  ).toBeVisible();
  await expect(page.getByText("随访事项已汇总到今日待办")).toHaveCount(0);

  // Direct routes show the connection empty state, never the business UI.
  await page.goto("/?view=followups", { waitUntil: "domcontentloaded" });
  await expect(page.getByText(GUIDE)).toBeVisible();
  await expect(
    page.getByRole("button", { name: "去设置连接" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: /新建随访计划/ }),
  ).toHaveCount(0);

  await page.goto("/?view=care", { waitUntil: "domcontentloaded" });
  await expect(page.getByText(GUIDE)).toBeVisible();

  // Connection panels stay available, with an explicit activation hint.
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
    await expect(tabs.getByRole("button", { name: /消息记录/ })).toHaveCount(0);
  } finally {
    await setFollowup(request, headers, true);
  }
});
