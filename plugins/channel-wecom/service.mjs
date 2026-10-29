import { WeComConnector } from "./server/wecom.mjs";
import { WecomApi } from "./server/wecom-api.mjs";
import { AIBOT_WS_URL, AibotSocket, toChatMessage } from "./server/wecom-aibot-ws.mjs";
import { WecomArchiveClient, collectorUrl } from "./server/wecom-archive.mjs";
import { createCustomerAdapter } from "./adapters/customer.mjs";
import { createKfAdapter } from "./adapters/kf.mjs";
import { createAibotAdapter } from "./adapters/aibot.mjs";
import { createArchiveAdapter } from "./adapters/archive.mjs";

const DIRECTORY_TICK_MS = 20000;
const CARE_VAULT_KEY = "care:channels:v1";

export function createWecomService({
  db,
  store,
  patients,
  vault,
  env = process.env,
  channel = null,
  options = {},
  directoryTickMs = DIRECTORY_TICK_MS,
  fetchImpl = fetch,
  now = Date.now,
  onStart = null,
  onStop = null,
  shouldRefreshAwaiting = null,
}) {
  const connector = new WeComConnector(store, patients, {
    vault,
    ...options,
  });
  const directory = connector.directory;
  const config = () => {
    const saved = vault?.get(CARE_VAULT_KEY) || {};
    return {
      corpId: connector.corpId || env.MEDICAL_WECOM_CORP_ID || "",
      kfSecret: saved.kfSecret || env.MEDICAL_WECOM_KF_SECRET || "",
      openKfId: saved.openKfId || env.MEDICAL_WECOM_KF_ID || "",
      appSecret: saved.appSecret || env.MEDICAL_WECOM_AGENT_SECRET || "",
      agentId: saved.agentId || env.MEDICAL_WECOM_AGENT_ID || "",
    };
  };

  const archive = new WecomArchiveClient({ fetch: fetchImpl });
  let aibot = null;
  let started = false;
  let starting = false;
  let timer = null;
  const registered = new Set();
  const adapters = [
    createCustomerAdapter({ connector, directory }),
    createKfAdapter({ config, WecomApi, fetchImpl, now }),
    createAibotAdapter({ getChannel: () => aibot }),
    createArchiveAdapter({ db, vault, archive }),
  ];

  const tickDirectory = () => {
    if (!connector.client) return;
    if (directory.due())
      directory.sync().catch((error) =>
        console.error(`[channel-wecom] 目录同步失败: ${error?.message || error}`),
      );
    if (!shouldRefreshAwaiting || shouldRefreshAwaiting())
      directory
        .refreshAwaiting()
        .catch((error) =>
          console.error(`[channel-wecom] 群发结果刷新失败: ${error?.message || error}`),
        );
  };

  const service = {
    apiVersion: 1,
    connector,
    directory,
    adapters,
    archive,
    WecomApi,
    WecomArchiveClient,
    AibotSocket,
    AIBOT_WS_URL,
    collectorUrl,
    toChatMessage,
    config,
    get started() {
      return started;
    },
    get timer() {
      return timer;
    },
    get aibot() {
      return aibot;
    },
    adapter(id) {
      return adapters.find((adapter) => adapter.id === id) || null;
    },
    // Connection verdicts consumed by the followup plugin's activation hook.
    // Customer-contact is ready when its API client is configured; WeCom KF is
    // ready once corp id, KF secret and open KF id are all present.
    followupChannels() {
      const care = config();
      const kfReady = Boolean(care.corpId && care.kfSecret && care.openKfId);
      return [
        {
          id: "wecom-customer",
          enabled: Boolean(connector.client),
          state: connector.client ? "ready" : "unconfigured",
        },
        {
          id: "wecom-kf",
          enabled: kfReady,
          state: kfReady ? "ready" : "unconfigured",
        },
      ];
    },
    createAibotSocket(input) {
      return new AibotSocket(input);
    },
    // chat-aibot stays in the fixed shell until T7.3; it receives the moved
    // socket/protocol implementation through this service and lets the plugin
    // lifecycle own its start/stop timing.
    attachAibot(channel) {
      aibot = channel;
      if (started) channel?.start?.();
      return channel;
    },
    handleCallback(query, raw) {
      return connector.callback(query, raw);
    },
    async start() {
      if (started || starting) return;
      starting = true;
      try {
        for (const adapter of adapters) await adapter.start?.();
        if (channel) {
          for (const adapter of adapters) {
            channel.register(adapter);
            registered.add(adapter.id);
          }
        }
        if (typeof onStart === "function") onStart(service);
        aibot?.start?.();
        timer = setInterval(tickDirectory, directoryTickMs);
        timer.unref?.();
        tickDirectory();
        started = true;
      } finally {
        starting = false;
      }
    },
    async stop() {
      if (!started) return;
      started = false;
      if (timer) clearInterval(timer);
      timer = null;
      aibot?.stop?.();
      if (typeof onStop === "function") onStop(service);
      if (channel) {
        for (const id of registered) channel.unregister?.(id);
      }
      registered.clear();
      for (const adapter of [...adapters].reverse()) await adapter.stop?.();
    },
    async drain() {
      await Promise.resolve(directory.running).catch(() => {});
    },
  };
  return Object.freeze(service);
}
