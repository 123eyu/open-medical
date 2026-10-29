# Open Medical 插件化重构方案（执行手册）

> 本文是这次重构的唯一依据。执行者（dsh）按任务编号逐个执行，验收者（Claude）逐个验收。
> 任务和本文冲突时以本文为准；本文没有写到的，先停下来在报告里提问，不要自行扩大范围。

---

## 0. 给执行者的总规则

1. **分支**：所有工作都在 `refactor/plugin-host` 分支上做（从 `main` 拉出）。每个任务一个或多个 commit，commit message 以任务编号开头，例如 `T3: add server plugin host`。不要 push，不要合并到 main。
2. **不改内核**：`server/core/**` 是通用 Agent 内核，除非任务里明确写了允许，否则不改。
3. **不改界面**：除非任务明确要求，现有界面的外观、文字和交互一律不变。截图基线（T2）就是判断标准。
4. **数据只增不删**：不删表、不删字段、不改已有字段的含义。新表必须带插件前缀。
5. **依赖**：除任务列出的依赖外，不新增依赖。
6. **每个任务结束时必须执行，并且全部 exit 0**：
   ```bash
   npm run lint
   npm run build
   npm test
   ```
   T2 之后还要加上 `npm run test:e2e`。
7. **完成报告**（最终回答必须使用这个格式）：
   ```
   ## 任务 <ID> 报告
   - 状态：完成 / 部分完成 / 阻塞
   - Commits：<hash> <message>（逐条列出）
   - 改动文件：<路径列表>
   - 验收命令与结果：<命令> → exit <码>（逐条列出）
   - 与方案的偏差及原因：
   - 风险 / 未完成项 / 需要验收者决定的问题：
   ```
8. 不确定时选更保守的做法，并在报告里说明。不要为了让测试通过去修改或删除测试。

---

## 1. 目标

Open Medical 是一个面向单医生、本地优先的桌面 Agent。核心是**通用 Agent 内核**，医疗只是落在内核上的一个垂直领域。

这次重构要达到三点：

1. **内核不变**：AgentRuntime、ToolRegistry、PermissionEngine、WorkspaceService、Provider、提案机制保持原样。
2. **固定核心 + 插件扩展**：医生每天都用的核心场景前端固定、保持稳定；其他场景全部做成插件，插件同时带数据库存储和前端扩展，可以持续增加。
3. **越用越轻**：新增场景 = 新增一个插件目录，不改固定区代码。医生通过同一个对话入口，就单个患者或全部患者提问（整理、洞察、相似病例、科研），由 Agent 自己调用工具完成。

**判断重构成功的标准**：在 `plugins/` 下新增一个场景时，不需要修改 `src/main.jsx`、`src/patients.jsx`、`src/doctor-agenda.jsx`、`server/agent.mjs`、`server/store.mjs`。

---

## 2. 框架

```
┌──────────────────────────────────────────────────────────────┐
│ 前端壳（固定区）                                              │
│  对话 · 患者列表/档案 · 复诊预约 · 今日待办 · 知识库 · 知识图谱 · 设置 │
│  └── 插槽：patient.tabs / patient.overviewCards / patient.actions │
│            agenda.sources / chat.resultCards / proposal.renderers │
│            settings.panels / tools.directory                     │
├──────────────────────────────────────────────────────────────┤
│ 插件（plugins/<id>/）                                          │
│  数据表(带前缀+迁移) · service · Agent 工具 · 技能 · 提示片段     │
│  · 提案类型 · HTTP 路由 · 待办来源 · 前端插槽组件                 │
├──────────────────────────────────────────────────────────────┤
│ 医疗领域适配（server/medical/medical-workspace-domain.mjs）      │
│  把固定区工具 + 已启用插件的工具/提示组合成一个 domain             │
├──────────────────────────────────────────────────────────────┤
│ 通用 Agent 内核（server/core/**，不改）                         │
└──────────────────────────────────────────────────────────────┘
          共用同一个 SQLite 连接（store.db），跨插件可以放在同一事务里
```

### 2.1 固定区与插件的边界

| 固定（内置） | 插件 |
| :--- | :--- |
| 对话：统一 Agent 入口、@范围、结果卡片容器、提案确认 | `similar-cases` 相似病例 |
| 患者列表 + 患者档案（概览、诊断病史、用药过敏、检验、就诊、资料库） | `literature` 文献研究 |
| 复诊预约（轻量：日期、原因、状态） | `research-stats` 科研统计/脱敏导出 |
| 今日待办（壳；事项全部来自 `agenda.sources`，固定区只自带"复诊"） | `trials` 临床试验入组 |
| 知识库（导入、检索、阅读、溯源、来源版本） | `drg` |
| 知识图谱 | `clinical-ref` 临床速查/量表 |
| 设置（模型连接、插件管理） | `care-tasks` 检查与转诊 |
| | `risk-rules` 风险规则 |
| | `followup` 随访触达（计划、问卷、AI 起草、联系登记、自动随访、聊天归档、患者消息），要求至少启用一个渠道 |
| | `channel-wecom`、`channel-wechat`（实现 followup 定义的渠道接口） |
| | `feishu-knowledge-bot`（依赖知识库） |
| | `learning` 医生习惯 · 专科模板包 · `doctor-notifications` |

---

## 3. 现状与代码入口

| 关注点 | 位置 | 现状 |
| :--- | :--- | :--- |
| 组合根 / HTTP 路由 | `server/agent.mjs`（2723 行，`createServer(options)`） | 一长串 `if (path === ...)`；已经有 `careApi(...)` 这种"子 API 返回是否已处理"的写法，可以沿用 |
| 测试注入点 | `createServer({ database: ":memory:", provider })` | 可以注入内存数据库和自定义 provider |
| 医疗 domain | `server/medical/medical-workspace-domain.mjs` | `registerTools` 里按 `run.policy.workflow` 硬编码挂工具（similar-case-search / trial-eligibility / patient-assessment） |
| 工具定义 | `server/medical-core.mjs`、`server/medical/*-tools.mjs`、`global-assistant.mjs` 等 | 约 100 个工具 |
| 提案 | `server/medical/pending-actions.mjs` | 中心化，直接认识所有提案类型 |
| 数据表 | 约 30 个文件各自 `CREATE TABLE IF NOT EXISTS` | 约 100 张表，没有归属，迁移没有版本号；`patients(id, data JSON)` |
| 前端路由 | `src/main.jsx`（2857 行）+ `src/navigation.js` | 嵌套三元渲染所有页面 |
| 患者页 tab | `src/patients.jsx:37` `RECORD_TABS` 及 600–730 行 | 硬编码 |
| 今日待办 | `server/medical/doctor-overview.mjs`、`src/doctor-agenda.jsx:8` | kinds 硬编码：risk/visit/followup/tracking/messages/trial/custom |
| 结果卡片 | `src/ui.jsx:202,226` `artifact.type === "similar_cases"` | 硬编码 |
| 现有"插件" | `server/core/plugins.mjs`（技能/命令/MCP 包）、`server/medical/extensions.mjs`（医生技能 + 自动化） | 都不管数据和 UI。**本次不动它们**，新机制命名为"领域插件（domain plugin）"，代码放在 `server/plugin-host/` 和 `plugins/` |
| 测试 | 无 | 没有任何测试 |

---

## 4. 实现逻辑

### 4.1 插件目录结构

```
plugins/
  <id>/
    plugin.mjs            # 服务端入口：export default definePlugin({...})
    migrations/           # 001_init.sql, 002_xxx.sql …（只增）
    skills/               # 可选，结构同根目录 skills/
    prompt.md             # 可选，追加到医疗系统提示的片段
    ui/
      index.jsx           # 前端入口：export default defineUiPlugin({...})
      *.jsx / *.css
    test/                 # 插件自己的测试（node:test）
```

### 4.2 服务端：`definePlugin`

```js
// server/plugin-host/define.mjs
export function definePlugin(spec) -> Object.freeze(normalized spec)

spec = {
  id: "similar-cases",               // /^[a-z][a-z0-9-]{1,39}$/
  version: "1.0.0",
  title: "相似病例",
  requires: {
    plugins: { "patient-core": "*" }, // 可选；必须已启用
    anyOf: [["channel-wecom", "channel-wechat"]], // 可选；每组至少启用一个
  },
  enabledByDefault: true,
  migrations: "./migrations",        // 可选
  tablePrefix: "similar_cases_",     // 有 migrations 时必填；迁移里的所有表名都必须以它开头
  setup(ctx) { return services },    // 返回本插件的 service 对象，注册为 ctx.services[id]
  tools(ctx, { registry, workspace, run }) {},   // 注册 Agent 工具（调用 ToolRegistry.register）
  prompt: "./prompt.md",             // 可选
  skills: "./skills",                // 可选
  proposals: {                       // 可选；提案类型 -> { validate(input, ctx), apply(input, ctx, tx) }
    "similar_cases.save": { validate, apply },
  },
  agendaSources: [                   // 可选；今日待办来源
    { kind: "trial", label: "试验入组", read(ctx, { now, patientId }) -> AgendaItem[] },
  ],
  api(ctx, req, url, io) -> Promise<boolean>, // 可选；返回 true 表示已处理；路由前缀必须是 /api/p/<id>/
  events: { "patient.archived": (payload, ctx) => {} }, // 可选
};
```

`ctx` 的内容：
`{ db, store, services /*固定区 + 已启用插件的 service*/, events: { emit, on }, now, log, config: { get(key), set(key,val) } /* 存在 plugin_config 表 */ }`

### 4.3 服务端：`PluginHost`

文件 `server/plugin-host/host.mjs`：

- `new PluginHost({ db, store, services, pluginDirs: [resolve(ROOT, "plugins")], enabled })`
- `load()`：扫描目录 → 校验 spec → 按 `requires` 做拓扑排序（缺依赖或有环时，该插件标记为 `unavailable` 并说明原因，**不让整个服务崩溃**）。
- `migrate()`：表 `plugin_migrations(plugin_id TEXT, name TEXT, applied_at TEXT, PRIMARY KEY(plugin_id,name))`，按文件名顺序执行未执行过的迁移，每个文件一个事务；校验表名前缀。
- `setup()`：依次调用 `setup(ctx)`，把返回值放进 `services[id]`。
- `registerTools(registry, workspace, run)`：对所有已启用插件调用 `tools(...)`。
- `promptFragments()`、`skillDirs()`、`proposalHandler(kind)`、`agendaItems(opts)`、`handleApi(req,url,io)`、`list()`（给设置页用：id、title、version、状态、原因）。
- 启用状态存在 `plugin_state(plugin_id TEXT PRIMARY KEY, enabled INTEGER, updated_at TEXT)`；缺省取 `enabledByDefault`。
- 停用插件：不注册工具、不返回待办、API 返回 404、前端插槽不渲染；**数据保留**。

接入点（只改这几处，各加几行）：
- `server/agent.mjs`：在 `createServer` 里创建 host、执行 load/migrate/setup；在 `/api/` 鉴权之后加 `if (path.startsWith("/api/p/") && await host.handleApi(...)) return;`；新增 `GET /api/plugins`（列表）和 `PUT /api/plugins/:id`（启用/停用）；`/api/bootstrap` 返回体中加入 `plugins: host.list()`。
- `server/medical/medical-workspace-domain.mjs`：`registerTools` 末尾调用 `host.registerTools(...)`；系统提示末尾拼上 `host.promptFragments()`。
- `server/medical/pending-actions.mjs`：遇到不认识的 kind 时，交给 `host.proposalHandler(kind)`；仍在同一个 `sqliteTransaction` 里执行 apply。
- 技能：把 `host.skillDirs()` 加入技能搜索路径（找到现有 SkillRegistry 的构造位置后追加）。

### 4.4 前端：插槽宿主

文件 `src/plugin-slots.jsx`：

```js
export const SLOTS = ["patient.tabs","patient.overviewCards","patient.actions",
  "agenda.sources","chat.resultCards","proposal.renderers","settings.panels","tools.directory"];
export function defineUiPlugin({ id, slots }) // slots: { "patient.tabs": [{ id, label, order, component: () => import("./Tab.jsx") }], "chat.resultCards": { "<artifactType>": () => import("./Card.jsx") }, ... }
export function registerUiPlugins(modules, enabledIds)
export function useSlot(name)                 // 返回已启用插件在该插槽的贡献，按 order 排序
export function Slot({ name, ...props })      // 渲染列表型插槽；每项包在 Suspense + ErrorBoundary 里
export function ResultCard({ artifact, fallback }) // chat.resultCards 按 artifact.type 查找，找不到时用 fallback
```

- 收集插件 UI：`import.meta.glob("../plugins/*/ui/index.jsx", { eager: true })`（入口模块可以 eager，组件本身用 `lazy`）。
- 启用列表取 `/api/bootstrap` 返回的 `plugins`。
- 插件 UI 只能引用 `src/components.jsx`、`src/plugin-kit/*`（T4 中把共享组件 re-export 到这里），以及插件自己的文件。

### 4.5 固定区要挂的插槽（T4）

| 插槽 | 位置 | 行为 |
| :--- | :--- | :--- |
| `patient.tabs` | `src/patients.jsx` 二级 tab 列表 | 固定 tab 之后追加插件 tab；当前 tab 是插件 tab 时渲染其组件，props `{ patient, onChanged, onNavigate }` |
| `patient.overviewCards` | 患者概览卡片网格末尾 | props `{ patient }` |
| `patient.actions` | 患者页"更多"菜单 | `{ id, label, run(patient, api) }` |
| `agenda.sources` | 服务端 `DoctorOverview.read` + 前端 kinds 列表 | 见 T6 |
| `chat.resultCards` | `src/ui.jsx` artifact 渲染处 | 先查插槽，找不到时走原逻辑 |
| `proposal.renderers` | 提案确认卡片 | 先查插槽，找不到时走原逻辑 |
| `settings.panels` | 设置页 | 新增"插件"分组：列表 + 启停开关 + 各插件面板 |
| `tools.directory` | "资料与工具"页 | 插件入口卡片 |

### 4.6 Agent 侧规则

- 插件工具通过 `tools(ctx, { registry, workspace, run })` 注册，`execute` 只能调用 service。
- 写入类工具必须生成提案（`*_propose`），不能直接写库。
- 插件的 `prompt.md` 控制在 600 字以内，只写"什么时候用哪个工具"。
- 现有按 `run.policy.workflow` 门控的逻辑（例如相似病例最多检索几次）**保留**，原样迁进插件。

### 4.7 数据规则

- 插件只读写带自己前缀的表。访问患者等核心数据时只能调用 `ctx.services.patients` 等固定区 service（T3 中把现有 `patients`、`store`、`pending` 等对象原样放进 `services`，不做改造）。
- 迁移旧表时**不改名**：旧表在 T5/T7 中保持原名，由插件的 service 继续读写，并在 `plugin.mjs` 里用 `legacyTables: ["case_library", ...]` 声明归属。前缀规则只约束新表。

---

## 5. 测试基础设施

- 单元/集成测试：`node:test`，脚本 `"test": "node --test --test-concurrency=1 \"tests/**/*.test.mjs\" \"plugins/*/test/*.test.mjs\""`（如果 glob 在当前 Node 版本下不工作，改成 `scripts/run-tests.mjs`）。
- 脚本化 provider：`tests/helpers/scripted-provider.mjs`，按顺序返回预设的模型回复（文本 / tool_calls），用于不联网、可重复地测试 Agent 流程。接口照抄 `server/provider.mjs` 中 `createProvider` 返回对象实际使用的方法（先读代码再实现）。
- 服务器夹具：`tests/helpers/server.mjs`，基于 `createServer({ database: ":memory:", provider })` 启动随机端口，加载示例资料（`server/medical/demo-pack.mjs`），返回 `{ url, token, close }`。
- E2E：新增 devDependency `@playwright/test`；`"test:e2e": "playwright test"`；配置 `playwright.config.mjs`，用 webServer 启动 `node server/agent.mjs --dev-web`（数据库指向临时文件），加载示例资料，视口 1440×1000，中文字体允许 1% 像素差。

---

## 6. 任务分解

> 每个任务都要单独验收通过后才能开始下一个。T7 之后的任务等 T5 验收后再细化。

### T0 环境与现状记录
- 拉分支 `refactor/plugin-host`；执行 `npm ci`、`npm run build`、`npm run lint`。
- 把 lint 现有的告警和错误数量记录到 `docs/refactor/BASELINE.md`（只记录，不修复）。如果 lint 现在就失败，记录失败的规则和文件；后续任务的要求变为"不新增 lint 错误"。
- **验收**：BASELINE.md 存在，build exit 0。

### T1 服务端基线测试
- 实现第 5 节中的 scripted-provider 和 server 夹具。
- 编写 `tests/baseline/*.test.mjs`，覆盖：
  1. 加载示例资料后，患者列表返回 3 位示例患者；患者详情包含诊断、用药、检验。
  2. 今日待办 `GET /api/doctor/overview` 返回的各 kind 计数和条目 id，保存为快照 `tests/baseline/__snapshots__/agenda.json`，测试中进行比对（时间固定为一个注入的 now；如果做不到注入，就比对 kind 与条目数量）。
  3. 提案流程：通过 API 创建一个患者档案修改提案 → 确认 → 患者 revision 加 1，字段已更新；对同一个提案重复确认应当失败或幂等。
  4. Agent 流程：用 scripted-provider 让模型依次调用 `list_patients` → 给出最终回答，断言 run 状态为 completed 且记录了工具调用。
  5. 相似病例：用 scripted-provider 走 similar-case-search 工作流，调用 `similar_case_search` → `finish_similar_case_search`，断言产生 `type: "similar_cases"` 的 artifact。
  6. 随访：创建随访计划提案 → 确认 → 今日待办出现对应事项。
- **验收**：`npm test` exit 0，至少 6 个测试；验收者会在独立环境中重跑。

### T2 E2E 截图基线
- 按第 5 节配置 Playwright。
- 截图页面：新建任务首页、患者列表、示例张沪生概览、该患者的诊疗辅助 tab、今日待办、知识库、示例体验、设置。
- 如果示例资料中的日期是写死的，截图时把时间冻结到示例数据对应的日期（Playwright `page.clock`），保证截图稳定。
- **验收**：`npm run test:e2e` 连续两次 exit 0；截图存在 `tests/e2e/__screenshots__/`。

### T3 服务端插件宿主
- 按 4.2、4.3 实现 `server/plugin-host/{define,host}.mjs`，以及 4.3 中列出的接入点。
- 新增测试插件 `tests/fixtures/plugins/hello/`（不放在 `plugins/` 下，测试时通过 `pluginDirs` 注入）：一张表、一个工具 `hello_echo`、一个 API `GET /api/p/hello/ping`、一个待办来源、一个提案类型。
- 测试 `tests/plugin-host/*.test.mjs`：加载、迁移幂等（运行两次）、前缀校验失败、缺依赖时标记 unavailable 且服务正常、停用后工具/API/待办都消失、提案 apply 在事务内（apply 抛错时回滚）。
- **验收**：T1、T2 全部仍然通过（界面零变化）；新测试通过；`server/core/**` 没有改动（`git diff main --stat -- server/core` 为空）。

### T4 前端插槽宿主 + 固定区挂插槽
- 实现 4.4，并按 4.5 挂好全部插槽；新增 `src/plugin-kit/index.js`，re-export `components.jsx` 中的通用组件。
- 设置页新增"插件"分组（这是本任务允许的唯一一处可见界面变化；T2 中设置页的截图需要更新，并在报告中说明）。
- 用 `tests/fixtures/plugins/hello/ui/` 做一个 E2E：启用 hello 后，患者页出现 "Hello" tab；停用后消失。
- **验收**：除设置页外，T2 截图零差异；hello E2E 通过。

### T5 试点：相似病例插件
- 新建 `plugins/similar-cases/`，迁入：`server/medical/similar-case-workflow.mjs`、`case-comparison.mjs`、`shared/case-comparison.mjs`（若仅此处使用）、`src/similar-cases.jsx`，以及 `medical-workspace-domain.mjs` 中相似病例相关的提示和工具挂载。
- `src/ui.jsx` 中的 `artifact.type === "similar_cases"` 分支删除，改为由 `chat.resultCards` 提供。
- 病例库 `cases.mjs`（`case_library` 表、`/api/cases`、`src/cases.jsx`）**本任务先不迁**，相似病例插件通过 `ctx.services` 调用它。
- 旧文件处理：直接移动（`git mv`），不保留副本；所有 import 改为新路径。
- 插件停用时：相似病例相关工具不注册；历史会话里已有的 similar_cases artifact 用通用 fallback 展示，不报错。
- **验收**：T1 第 5 项测试改为从插件路径运行并通过；T2 截图零差异；新增测试覆盖停用后的行为；`git grep -n "similar_cases" src/ui.jsx` 无结果。

### T6 今日待办改为来源注册
- `DoctorOverview.read` 改为：固定区只自带 `visit`（复诊）；其他 kind 由 `host.agendaItems()` 提供。
- 现有的 risk/followup/tracking/messages/trial/custom 逻辑先原样包进一个**过渡插件** `plugins/legacy-agenda/`，每个 kind 一个 source；之后迁移对应插件时，再把相应 source 搬过去。
- 前端 `src/doctor-agenda.jsx` 的 kinds 列表改成来自 `/api/doctor/overview` 返回的 `kinds`（label 与顺序和现在一致）。
- **验收**：T1 中的待办快照完全一致；T2 待办截图零差异；停用 legacy-agenda 后待办只剩复诊。

### T7+（等 T5 验收后再细化）
- T7 `followup` + `channel-wecom` + `channel-wechat`（随访触达插件族；包括患者页 messages/followups tab、care inbox、chat-followups/autofollow、渠道接口）。
- T8 `literature`、`research-stats`、`clinical-ref`。
- T9 `trials`、`drg`、`care-tasks`、`risk-rules`。
- T10 `feishu-knowledge-bot`、`doctor-notifications`、`learning`。
- T11 清理：删掉已经空了的旧页面和路由，`src/main.jsx` 改为按路由表懒加载。

---

## 7. 验收方式（验收者执行）

每个任务：
1. 阅读 dsh 报告，对照本文检查范围是否越界。
2. `git log main..refactor/plugin-host`、`git diff main --stat`；抽查关键 diff。
3. 在独立的 Linux 环境中 clone 该分支，执行 `npm ci && npm run lint && npm run build && npm test`。
4. 检查硬性约束：`server/core` 没有改动；没有删除表或字段；没有新增未列出的依赖；测试没有被削弱。
5. 结论只有三种：**通过** / **返工（列出具体问题）** / **方案调整（更新本文后重新下发）**。
