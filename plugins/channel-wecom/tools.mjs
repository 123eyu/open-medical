const definition = (name, description, properties = {}, required = []) => ({
  type: "function",
  function: {
    name,
    description,
    parameters: { type: "object", properties, required, additionalProperties: false },
  },
});
const text = { type: "string" };

// Read-only customer-contact tools only depend on this plugin's directory.
// Binding/group-message proposals stay in care/tools.mjs until T7.3 because
// their pending actions are applied by CareEngine.
export function registerWecomTools(ctx, { registry }) {
  const directory = () => {
    const service = ctx.service("channel-wecom");
    const value = service.connector.directory;
    if (!value?.c.client)
      throw new Error(
        "尚未配置企业微信客户联系，请在「患者消息 → 设置」或接入向导第 4 步填写客户联系 Secret",
      );
    return value;
  };
  const register = (name, description, properties, required, execute) =>
    registry.register({
      permission: "tools.execute",
      capability: { backend: "local" },
      definition: definition(name, description, properties, required),
      execute,
    });

  register(
    "wecom_customers",
    "查询助理企业微信里的客户（自动定期同步）。每位客户带备注、备注手机号、标签、所在客户群、已关联患者，以及未关联时系统推荐的患者和依据。state：bound/suggested/unmatched，可逗号分隔；query 按昵称/备注/手机号/标签/患者名搜索。",
    {
      state: text,
      query: text,
      limit: { type: "integer" },
    },
    [],
    ({ state, query, limit }) => {
      const value = directory().contacts({
        status: state,
        query,
        limit: Math.min(limit || 30, 100),
      });
      return {
        counts: value.counts,
        sync: value.status,
        customers: value.contacts.map((c) => ({
          member: c.member,
          external: c.external,
          name: c.name,
          remark: c.remark,
          description: c.description,
          mobiles: c.mobiles,
          tags: c.tags,
          addedAt: c.addedAt,
          state: c.state,
          patients: c.bindings.map((b) => ({
            patientId: b.patientId,
            name: b.patientName,
            relationship: b.relationship,
          })),
          suggestion: c.suggestion.candidates.length
            ? c.suggestion
            : undefined,
          groups: c.groups.map((g) => g.name),
        })),
      };
    },
  );
  register(
    "wecom_patient_contacts",
    "读取某患者关联的企业微信客户（本人/家属）、所在客户群，以及可能是该患者但尚未关联的客户。",
    { patientId: text },
    ["patientId"],
    ({ patientId }) => directory().patient(patientId),
  );
  register(
    "wecom_groups",
    "列出助理的企业微信客户群（群名、群主、人数、群里已关联的患者）；传 chatId 返回该群成员明细与群发任务。",
    { chatId: text, query: text },
    [],
    ({ chatId, query }) =>
      chatId ? directory().group(chatId) : directory().groups({ query }),
  );
  register(
    "wecom_sync",
    "立即同步企业微信客户与客户群（平时每 6 小时自动同步，一般不需要）。",
    {},
    [],
    () => directory().sync(),
  );
}
