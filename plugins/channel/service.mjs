import { check } from "../../server/errors.mjs";
import {
  CHANNEL_API_VERSION,
  normalizeCapabilities,
  normalizeSendResult,
  validateAdapter,
} from "./contract.mjs";
import { FeishuRegistration } from "./server/feishu-registration.mjs";

const MESSAGE_TABLES = new Set([
  "message_channels",
  "message_peers",
  "message_inbox",
]);

const errorText = (error) =>
  String(error?.message || error?.code || error || "渠道发送失败").slice(0, 1000);

/**
 * Registry + unified send facade for channel adapters. The service never
 * creates a send on its own: `confirm` adapters require an explicit
 * `{ confirmed: true }` from a doctor-reviewed action, `manual` adapters only
 * return an awaiting-member result, and `none` adapters are read-only and
 * never receive a send call.
 */
export function createChannelService({ gateway } = {}) {
  check(gateway, "CHANNEL_SERVICE", "channel 服务需要消息网关实例");
  const adapters = new Map();

  const describe = (adapter, capabilities) =>
    Object.freeze({
      id: adapter.id,
      label: adapter.label,
      capabilities,
    });

  const service = {
    apiVersion: CHANNEL_API_VERSION,
    gateway,
    rows(table) {
      check(
        MESSAGE_TABLES.has(table),
        "CHANNEL_TABLE",
        `channel 服务不允许读取表 ${table || "(未指定)"}`,
      );
      return gateway.rows(table);
    },
    createFeishuRegistration(options) {
      return new FeishuRegistration(options);
    },
    register(adapter) {
      validateAdapter(adapter);
      check(
        !adapters.has(adapter.id),
        "CHANNEL_ADAPTER_EXISTS",
        `渠道适配器 ${adapter.id} 已注册`,
        409,
      );
      const capabilities = normalizeCapabilities(adapter.capabilities);
      adapters.set(adapter.id, { adapter, capabilities });
      return describe(adapter, capabilities);
    },
    unregister(id) {
      return adapters.delete(id);
    },
    list() {
      return [...adapters.values()]
        .sort((left, right) => left.adapter.id.localeCompare(right.adapter.id))
        .map(({ adapter, capabilities }) => describe(adapter, capabilities));
    },
    adapters() {
      return service.list();
    },
    get(id) {
      return adapters.get(id)?.adapter || null;
    },
    async send(adapterId, target, message, options = {}) {
      const opts = options || {};
      const entry = adapters.get(adapterId);
      const adapter = entry?.adapter;
      if (!adapter)
        return Object.freeze({
          state: "failed",
          error: `渠道适配器 ${adapterId || "(未指定)"} 未注册`,
          retryable: false,
        });
      const mode = entry.capabilities.send;
      if (mode === "none")
        return Object.freeze({
          state: "failed",
          error: `渠道适配器 ${adapterId} 是只读渠道，不提供发送路径`,
          retryable: false,
        });
      if (mode === "manual")
        return Object.freeze({
          state: "awaiting_member",
          error: "该渠道只生成人工任务，需由医生确认后在原渠道发送",
          retryable: false,
        });
      if (mode === "confirm" && opts.confirmed !== true)
        return Object.freeze({
          state: "awaiting_member",
          error: "发送给患者前需要医生确认",
          retryable: false,
        });
      try {
        const result = await adapter.send(target, message, opts);
        return normalizeSendResult(result);
      } catch (error) {
        return Object.freeze({
          state: "unknown",
          error: errorText(error),
          retryable: false,
        });
      }
    },
  };
  return Object.freeze(service);
}
