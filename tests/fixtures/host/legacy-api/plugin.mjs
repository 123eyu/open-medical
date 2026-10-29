import { definePlugin } from "../../../../server/plugin-host/define.mjs";

export default definePlugin({
  id: "legacy-api",
  version: "1.0.0",
  title: "Legacy API 测试",
  enabledByDefault: true,
  legacyApiPaths: [
    { method: "GET", path: "/api/legacy/method-only" },
    { method: "POST", path: "/api/legacy/post" },
    { method: "GET", path: "/api/legacy/order/exact" },
    { method: "GET", path: "/api/legacy/order/:id" },
    { method: "GET", path: "/api/legacy/order/*" },
    { method: "GET", path: "/api/patients/:id/legacy-echo" },
    { method: "GET", path: "/api/legacy/fallthrough" },
    { method: "GET", path: "/api/legacy/boom" },
  ],
  api(ctx, req, url, io) {
    const path = url.pathname;
    if (path === "/api/legacy/method-only")
      return io.send(200, { route: "method-only", method: req.method }), true;
    if (path === "/api/legacy/post" && req.method === "POST")
      return io.send(201, { route: "post", body: true }), true;
    if (path === "/api/legacy/order/exact")
      return io.send(200, { route: "exact" }), true;
    if (path === "/api/legacy/order/other")
      return io.send(200, { route: "param", id: io.params.id }), true;
    if (path === "/api/legacy/order/other/deep")
      return io.send(200, { route: "wildcard", rest: io.params.rest }), true;
    if (path === "/api/legacy/fallthrough") return false;
    if (path === "/api/legacy/boom")
      throw Object.assign(new Error("legacy boom"), { status: 409, code: "LEGACY_BOOM" });
    if (path.endsWith("/legacy-echo") && path.startsWith("/api/patients/"))
      return io.send(200, { route: "patient", id: io.params.id }), true;
    return false;
  },
});
