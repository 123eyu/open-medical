import { expect, test } from "@playwright/test";

const PATIENT_NAME = "示例·张沪生";

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

test("停用 followup 后患者沟通与随访 tab 消失，重新启用后恢复", async ({
  page,
  request,
}) => {
  const headers = await auth(request);
  await setFollowup(request, headers, true);

  const patientsResponse = await request.get("/api/patients?summary=1", {
    headers,
  });
  expect(patientsResponse.ok()).toBeTruthy();
  const { patients } = await patientsResponse.json();
  const patient = patients.find((item) => item.name === PATIENT_NAME);
  expect(patient, `${PATIENT_NAME} should be seeded`).toBeTruthy();
  const patientUrl = `/?view=patients&patient=${encodeURIComponent(patient.id)}`;

  try {
    await setFollowup(request, headers, false);
    await page.goto(patientUrl, { waitUntil: "domcontentloaded" });

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
    await expect(
      page.getByText("随访事项已汇总到今日待办"),
    ).toHaveCount(0);

    await tabs.getByRole("button", { name: "复诊预约", exact: true }).click();
    await expect(page.getByText("提醒草稿读取失败")).toHaveCount(0);
    await expect(page.getByText("接口不存在")).toHaveCount(0);

    await page.goto("/?view=patients", { waitUntil: "domcontentloaded" });
    await expect(
      page.getByRole("heading", { name: "患者管理", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByText("随访事项已汇总到今日待办"),
    ).toHaveCount(0);

    await page.goto("/?view=settings&settingsTab=followup", {
      waitUntil: "domcontentloaded",
    });
    await expect(
      page.getByRole("button", { name: "患者随访", exact: true }),
    ).toHaveCount(0);
  } finally {
    // Never leave followup disabled: baseline screenshots and the plugin spec
    // must see the same default state.
    await setFollowup(request, headers, true);
  }

  await page.goto(patientUrl, { waitUntil: "domcontentloaded" });
  await page
    .getByRole("navigation", { name: "患者工作内容" })
    .getByRole("button", { name: "沟通与随访", exact: true })
    .click();
  const tabs = page.getByRole("navigation", { name: "患者栏目" });
  await expect(
    tabs.getByRole("button", { name: /消息记录/ }),
  ).toBeVisible();
  await expect(
    tabs.getByRole("button", { name: "随访计划", exact: true }),
  ).toBeVisible();
});
