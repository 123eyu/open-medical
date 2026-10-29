import { definePlugin } from "../../server/plugin-host/define.mjs";
import { ResearchService, researchTools } from "./server/research.mjs";

const REPLY = (send, status, value) => {
  send(status, value);
  return true;
};

function createResearchApi(ctx) {
  const service = () => ctx.plugins["research-stats"]?.service || ctx.services.researchStats;
  return async function researchApi(req, url, io) {
    if (req.method !== "POST") return false;
    const parts = url.pathname.split("/").filter(Boolean);
    if (parts[2] === "profile" || parts[2] === "test" || parts[2] === "sample-size" || parts[2] === "deidentify") {
      const input = await io.body();
      if (parts[2] === "sample-size")
        return REPLY(io.send, 200, service().sampleSize(input));
      const sources = ctx.services.researchHost?.sourcesOf(input.sessionId) || [];
      if (parts[2] === "profile")
        return REPLY(io.send, 200, service().profile({ ...input, sources }));
      if (parts[2] === "test")
        return REPLY(io.send, 200, service().test({ ...input, sources }));
      return REPLY(io.send, 200, service().deidentify({ ...input, sources }));
    }
    return false;
  };
}

export default definePlugin({
  id: "research-stats",
  version: "1.0.0",
  title: "科研统计与脱敏导出",
  enabledByDefault: true,
  provides: { service: "research-stats", apiVersion: 1 },
  prompt: "./prompt.md",
  legacyApiPaths: [{ method: "POST", path: "/api/research/*" }],
  setup() {
    return new ResearchService();
  },
  tools(ctx, { registry }) {
    const service = ctx.plugins["research-stats"]?.service || ctx.services.researchStats;
    for (const plugin of researchTools(service).filter(
      (item) => item.definition.function.name !== "cohort_profile",
    ))
      registry.register({
        permission: "tools.execute",
        capability: plugin.capability || { backend: "local" },
        definition: plugin.definition,
        execute: plugin.execute,
      });
  },
  api: (ctx, req, url, io) => createResearchApi(ctx)(req, url, io),
});
