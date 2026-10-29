import { definePlugin } from "../../server/plugin-host/define.mjs";
import { DoctorNotifications } from "./server/doctor-notifications.mjs";

const REPLY = (send, status, value) => {
  send(status, value);
  return true;
};

const serviceOf = (ctx) => ctx.plugins["doctor-notifications"]?.service;

function createDoctorNotificationsApi(ctx) {
  return async function doctorNotificationsApi(req, url, io) {
    const parts = url.pathname.split("/").filter(Boolean);
    if (parts[0] !== "api" || parts[1] !== "doctor-notifications") return false;
    const service = serviceOf(ctx);
    if (!service) return false;

    if (parts.length === 2 && req.method === "GET")
      return REPLY(io.send, 200, service.settings());
    if (parts.length === 3 && parts[2] === "feishu-binding") {
      const binding = service.bindingOrNull();
      if (!binding) return false;
      if (req.method === "POST") return REPLY(io.send, 200, await binding.begin());
      if (req.method === "DELETE")
        return REPLY(io.send, 200, binding.cancel((await io.body()).id));
      return false;
    }
    if (
      parts.length === 4 &&
      parts[2] === "feishu-binding" &&
      parts[3] === "status" &&
      req.method === "POST"
    ) {
      const binding = service.bindingOrNull();
      if (!binding) return false;
      return REPLY(io.send, 200, await binding.poll((await io.body()).id));
    }
    if (parts.length === 3 && req.method === "PUT")
      return REPLY(io.send, 200, service.save(parts[2], await io.body()));
    if (parts.length === 4 && req.method === "POST") {
      const channel = parts[2], action = parts[3], input = await io.body();
      if (action === "test") return REPLY(io.send, 200, await service.test(channel));
      if (action === "send") return REPLY(io.send, 200, await service.send(channel, input));
      if (action === "disconnect")
        return REPLY(io.send, 200, service.disconnect(channel, input.expectedRevision));
      if (channel === "wechat" && action === "qrcode")
        return REPLY(io.send, 200, await service.startQr());
      if (channel === "wechat" && action === "qrcode-status")
        return REPLY(io.send, 200, await service.pollQr(input.id));
    }
    return false;
  };
}

export default definePlugin({
  id: "doctor-notifications",
  version: "1.0.0",
  title: "医生提醒",
  enabledByDefault: true,
  provides: { service: "doctor-notifications", apiVersion: 1 },
  migrations: "./migrations",
  tablePrefix: "doctor_notification_",
  legacyApiPaths: [
    { method: "*", path: "/api/doctor-notifications" },
    { method: "*", path: "/api/doctor-notifications/*" },
  ],
  setup(ctx) {
    const host = ctx.services.notificationHost || {};
    return new DoctorNotifications(ctx.services.store, host.vault, {
      createFeishuRegistration: (input) =>
        ctx.plugins.channel?.service?.createFeishuRegistration?.(input) || null,
      patients: () => ctx.services.patients,
      // These two data sources belong to other plugins. A disabled plugin
      // leaves the corresponding part of the digest empty instead of failing.
      followups: () =>
        ctx.services.followupHost?.isActive?.("followup")
          ? ctx.services.followups
          : null,
      careTasks: () => ctx.services.careTasks?.(),
      ...(host.options || {}),
    });
  },
  lifecycle: {
    start(ctx) {
      serviceOf(ctx)?.start();
    },
    async stop(ctx) {
      await serviceOf(ctx)?.stop();
    },
  },
  api: (ctx, req, url, io) => createDoctorNotificationsApi(ctx)(req, url, io),
});
