import { definePlugin } from "../../../../server/plugin-host/define.mjs";
import { AppError } from "../../../../server/errors.mjs";

// Fixture for the legacyProposalTypes contract: the proposal type predates the
// plugin namespace and must keep its exact database string.
export default definePlugin({
  id: "legacy-proposal",
  version: "1.0.0",
  title: "历史提案示例插件",
  enabledByDefault: false,
  migrations: "./migrations",
  tablePrefix: "legacy_proposal_",
  setup(ctx) {
    const db = ctx.db;
    return {
      list() {
        return db
          .prepare("SELECT name,message FROM legacy_proposal_log ORDER BY id")
          .all();
      },
    };
  },
  legacyProposalTypes: {
    "legacy-proposal-create": {
      validate({ payload: input }) {
        if (!input || typeof input.name !== "string" || !input.name.trim())
          throw new Error("历史提案需要 name");
        if (typeof input.message !== "string" || !input.message.trim())
          throw new Error("历史提案需要 message");
        return input;
      },
      apply(input, ctx, tx) {
        tx.prepare(
          "INSERT INTO legacy_proposal_log(name,message,created_at) VALUES (?,?,?)",
        ).run(input.name.trim(), input.message.trim(), new Date().toISOString());
        if (input.fail === true)
          throw new AppError(
            "LEGACY_PROPOSAL_APPLY_FAILED",
            "legacy proposal apply failed",
            422,
          );
        return {
          name: input.name.trim(),
          message: input.message.trim(),
          type: "legacy-proposal-create",
        };
      },
    },
  },
  api(ctx, req, url, io) {
    if (
      url.pathname === "/api/p/legacy-proposal/propose" &&
      req.method === "POST"
    ) {
      return io
        .body(req)
        .then((input) => {
          const proposal = ctx.proposals.create({
            kind: "legacy-proposal-create",
            patientId: input.patientId,
            input: {
              name: input.name,
              message: input.message,
              fail: input.fail,
            },
            summary: `历史提案：${input.name || ""}`,
          });
          io.send(201, { proposal });
          return true;
        })
        .catch((error) => {
          io.error(error);
          return true;
        });
    }
    return false;
  },
});
