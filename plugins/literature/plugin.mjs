import { definePlugin } from "../../server/plugin-host/define.mjs";
import { LiteratureService, literatureTools } from "./server/literature.mjs";
import {
  LITERATURE_RESEARCH_GUIDANCE,
  literatureRunEvidence,
  researchAnswer,
  verifyLiteratureResearch,
} from "./server/literature-research.mjs";

const REPLY = (send, status, value) => {
  send(status, value);
  return true;
};

function createLiteratureApi(ctx) {
  const service = () => ctx.plugins.literature?.service || ctx.services.literature;
  return async function literatureApi(req, url, io) {
    const send = io.send;
    const body = io.body;
    const path = url.pathname;
    const parts = path.split("/").filter(Boolean);
    const numberParam = (key) => {
      const raw = url.searchParams.get(key);
      return raw === null || raw === "" ? undefined : Number(raw);
    };
    if (parts[2] === "search" && req.method === "GET")
      return REPLY(
        send,
        200,
        await service().search({
          query: url.searchParams.get("query") || undefined,
          source: url.searchParams.get("source") || undefined,
          yearFrom: numberParam("yearFrom"),
          yearTo: numberParam("yearTo"),
          limit: numberParam("limit"),
          sort: url.searchParams.get("sort") || undefined,
        }),
      );
    if (parts[2] === "article" && req.method === "GET")
      return REPLY(
        send,
        200,
        await service().fetchArticle({
          pmid: url.searchParams.get("pmid") || undefined,
          doi: url.searchParams.get("doi") || undefined,
        }),
      );
    if (parts[2] === "import" && req.method === "POST") {
      const input = await body();
      const article = await service().fetchArticle({
        pmid: input.pmid,
        doi: input.doi,
      });
      const name = article.pmid
        ? `PMID-${article.pmid}.md`
        : `DOI-${String(article.doi)
            .replace(/[^A-Za-z0-9.-]/g, "_")
            .slice(0, 80)}.md`;
      const sessionId = ctx.services.literatureHost?.identifier
        ? ctx.services.literatureHost.identifier(input.sessionId)
        : input.sessionId;
      const file = ctx.services.literatureHost.addMaterial(sessionId, {
        name,
        text: service().materialText(article),
      });
      return REPLY(send, 201, { file, article });
    }
    return false;
  };
}

export default definePlugin({
  id: "literature",
  version: "1.0.0",
  title: "文献研究",
  enabledByDefault: true,
  provides: { service: "literature", apiVersion: 1 },
  prompt: "./prompt.md",
  legacyApiPaths: [{ method: "*", path: "/api/literature/*" }],
  setup(ctx) {
    const host = ctx.services.literatureHost || {};
    return host.service || new LiteratureService(ctx.store, host.options || {});
  },
  tools(ctx, { registry }) {
    const service = ctx.plugins.literature?.service || ctx.services.literature;
    for (const plugin of literatureTools(service))
      registry.register({
        permission: "tools.execute",
        capability: plugin.capability || { backend: "network" },
        definition: plugin.definition,
        execute: plugin.execute,
      });
  },
  workflows: {
    "literature-research": {
      guidance: () => LITERATURE_RESEARCH_GUIDANCE,
      beforeComplete(pluginContext, { messages, text, context }) {
        verifyLiteratureResearch({
          messages,
          text,
          evidence: literatureRunEvidence(pluginContext.db, context),
        });
      },
      answer: (workspace, runId, result) =>
        researchAnswer(workspace, runId, result),
    },
  },
  api: (ctx, req, url, io) => createLiteratureApi(ctx)(req, url, io),
});
