import { definePlugin } from "../../server/plugin-host/define.mjs";
import {
  calculateScale,
  listScales,
  scaleTools,
} from "./server/scales.mjs";
import { searchIcd9 } from "./server/icd9.mjs";
import {
  adverseReactionTool,
  assessAdverseReaction,
} from "./server/adverse-reactions.mjs";

const REPLY = (send, status, value) => {
  send(status, value);
  return true;
};

function createClinicalRefApi(ctx) {
  const service = () => ctx.plugins["clinical-ref"]?.service || ctx.services.clinicalRef;
  return async function clinicalRefApi(req, url, io) {
    const path = url.pathname;
    const parts = path.split("/").filter(Boolean);
    if (path === "/api/scales" && req.method === "GET")
      return REPLY(io.send, 200, { scales: service().scales.list() });
    if (
      parts[0] === "api" &&
      parts[1] === "scales" &&
      parts.length === 4 &&
      parts[3] === "calculate" &&
      req.method === "POST"
    ) {
      const input = await io.body();
      return REPLY(
        io.send,
        200,
        service().scales.calculate(parts[2], input.answers || {}),
      );
    }
    if (path === "/api/icd9" && req.method === "GET")
      return REPLY(io.send, 200, {
        codes: service().icd9.search(url.searchParams.get("q"), {
          limit: url.searchParams.get("limit")
            ? Number(url.searchParams.get("limit"))
            : undefined,
        }),
      });
    if (path === "/api/adr-assess" && req.method === "POST")
      return REPLY(io.send, 200, service().adr.assess(await io.body()));
    return false;
  };
}

export default definePlugin({
  id: "clinical-ref",
  version: "1.0.0",
  title: "临床速查",
  enabledByDefault: true,
  provides: { service: "clinical-ref", apiVersion: 1 },
  prompt: "./prompt.md",
  legacyApiPaths: [
    { method: "GET", path: "/api/scales" },
    { method: "POST", path: "/api/scales/:id/calculate" },
    { method: "GET", path: "/api/icd9" },
    { method: "POST", path: "/api/adr-assess" },
  ],
  setup() {
    return {
      scales: { list: listScales, calculate: calculateScale },
      icd9: { search: searchIcd9 },
      adr: { assess: assessAdverseReaction },
    };
  },
  tools(_ctx, { registry }) {
    for (const plugin of [...scaleTools(), adverseReactionTool()])
      registry.register({
        permission: "tools.execute",
        capability: plugin.capability || { backend: "local" },
        definition: plugin.definition,
        execute: plugin.execute,
      });
  },
  api: (ctx, req, url, io) => createClinicalRefApi(ctx)(req, url, io),
});
