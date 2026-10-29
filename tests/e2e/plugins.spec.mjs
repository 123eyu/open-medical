import { expect, test } from "@playwright/test";

const PATIENT_NAME = "示例·张沪生";
const PLUGIN_TITLE = "Hello 示例插件";

test.describe.configure({ mode: "serial" });

async function auth(request) {
  const response = await request.get("/api/bootstrap");
  expect(response.ok()).toBeTruthy();
  const { token } = await response.json();
  return { "x-medical-token": token };
}

async function setHello(request, headers, enabled) {
  const response = await request.put("/api/plugins/hello", {
    headers,
    data: { enabled },
  });
  expect(response.ok()).toBeTruthy();
  return response.json();
}

test("启用 hello 插件后出现患者 tab 与设置面板，停用后消失", async ({
  page,
  request,
}) => {
  const headers = await auth(request);
  await setHello(request, headers, false);

  try {
    await setHello(request, headers, true);

    const patientsResponse = await request.get("/api/patients?summary=1", {
      headers,
    });
    expect(patientsResponse.ok()).toBeTruthy();
    const { patients } = await patientsResponse.json();
    const patient = patients.find((item) => item.name === PATIENT_NAME);
    expect(patient, `${PATIENT_NAME} should be seeded`).toBeTruthy();

    await page.goto(
      `/?view=patients&patient=${encodeURIComponent(patient.id)}`,
      { waitUntil: "domcontentloaded" },
    );
    const helloTab = page.getByRole("button", { name: "Hello", exact: true });
    await expect(helloTab).toBeVisible();
    await helloTab.click();
    await expect(
      page.getByText(`Hello, ${PATIENT_NAME}`, { exact: true }),
    ).toBeVisible();

    await page.goto("/?view=settings&settingsTab=plugins", {
      waitUntil: "domcontentloaded",
    });
    await expect(
      page.getByRole("heading", { name: "插件", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByText(PLUGIN_TITLE, { exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "Hello 插件设置面板" }),
    ).toBeVisible();

    const toggle = page.getByRole("checkbox", {
      name: `启用 ${PLUGIN_TITLE}`,
    });
    await expect(toggle).toBeChecked();
    await toggle.uncheck();
    await expect(toggle).not.toBeChecked();
    await expect(
      page.getByRole("heading", { name: "Hello 插件设置面板" }),
    ).toHaveCount(0);

    await page.goto(
      `/?view=patients&patient=${encodeURIComponent(patient.id)}`,
      { waitUntil: "domcontentloaded" },
    );
    await expect(
      page.getByRole("button", { name: "Hello", exact: true }),
    ).toHaveCount(0);
  } finally {
    // Never leave the fixture enabled: baseline screenshots must stay unchanged.
    await setHello(request, headers, false);
  }
});
