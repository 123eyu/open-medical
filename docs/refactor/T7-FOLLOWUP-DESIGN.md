# T7.0 随访触达插件组迁移设计

> 状态：调研完成，等待 T7.1 实施
> 范围：`followup`（随访）+ `channel-wecom`（企业微信）+ `channel-wechat`（个人微信）
> 原则：T7.0 是只读调研，本文只描述设计与验收，不改任何代码、表、路由或测试。
> 基线：`tests/baseline/*.test.mjs`、`tests/e2e/__screenshots__/01-home.png` … `08-settings.png`、`npm run lint && npm run build && npm test`（T2 起加 `npm run test:e2e`）。

## 0. 结论摘要

1. **现有代码里没有可直接复用的“渠道抽象”**。同时存在四套互不兼容的鸭子契约：`ChatConnectorRegistry` 的 `status/read/conversations`、`MessageTransport` 的 `start/stop/send`、`CareChannels` 的 `choose/send/kfReady`、企业微信客户联系的 `draft/submit/refresh`。`send` 有三份不同签名，`status` 有两份不同语义（连接状态 vs 后台任务状态）。T7 必须先定义统一的 `channel.adapters`，否则“渠道插件化”只会把四套契约搬进插件。
2. **随访与渠道必须拆成两个插件域**，但共享一个**固定区提醒总线**。`reminders` 同时被随访、风险规则、医生提醒、扩展、患者摘要、患者列表和 agenda 使用，不能整体搬进 `followup`；`patient_messages` 是患者消息 intake 的共享表，也不是随访私有表；`appointments` 属于固定区复诊预约。把这三张表误判为随访私有，会直接破坏 `tests/baseline/followup.test.mjs` 与 `agenda.test.mjs`。
3. **`follow_ups` / `followup_plans` 的语义所有权归 `followup`，但建表暂时保留在 `server/store.mjs`**。T7 期间以 `legacyTables` 声明所有权，插件迁移只创建新增表，不 drop、不改字段；等 T11 统一清理固定区建表。这样满足“新增插件不需要改 `server/core`”，也不制造数据迁移风险。
4. **固定区仍保留 7 条基线路径**：`/api/agent/run`、`/api/sessions/:id`、`/api/pending-actions*`、`/api/doctor/overview`、`/api/reminders`、`/api/patients/:id`、`/api/wecom/callback`。T7 只能把随访私有路由迁到 `legacyApiPaths`，不能改这 7 条路径或响应形状。
5. **宿主当前缺四项关键能力**：`legacyApiPaths`、`patient.tabs.area`、插件生命周期 `start/stop/drain`、插件间服务调用。四项都必须在 T7.1 先做，且不带业务迁移；否则后续每个子任务都会临时改固定区，违背插件化目标。
6. **最终“无渠道时隐藏随访”必须是最后一个独立产品变更**。结构迁移阶段保持 UI 与行为零变化；隐藏只隐藏入口，不删除 API、表、Agent 工具或既有提醒数据。否则 `followup` 基线（无任何渠道也创建随访）和 agenda 截图会失败。

---

## 1. 模块清单

### 1.1 随访核心（server，3,149 行）

| 文件 | 行数 | 职责 | 导出 / 入口 | 固定区引用 |
|---|---:|---|---|---|
| `server/followups.mjs` | 985 | 随访计划、模板、到期执行、提醒生成、联系登记、结果闭环 | `FollowUpManager` L19 | `agent.mjs:693-697,765,2705,2725,2753`；`pending-actions.mjs:489-490`；`medical-workspace-domain.mjs:221-226` |
| `server/followup-surveys.mjs` | 699 | 随访问卷渲染、发送、答案解析、评分、问卷告警 | `renderQuestionnaire` L3、`QUESTION_TYPES` L12、`normalizeQuestionnaire` L20、`parseAnswer` L138、`scoreSurvey` L225、`FollowUpSurveys` L267 | `agent.mjs:804-823`；`followups.mjs:571`；`chat-aibot.mjs:199,318`；`risk-rules` 告警回调 `agent.mjs:822` |
| `server/chat-followups.mjs` | 658 | 聊天渠道连接、绑定、消息入站、去重、草稿、发送、自动同步 | `ChatFollowups` L15 | `agent.mjs:798,799,2710,2730`；`server` 暴露 `2696` |
| `server/chat-followups-api.mjs` | 38 | `/api/chat-followups` 纯 HTTP 分发 | `chatFollowupsApi` L1 | `agent.mjs:1594` |
| `server/chat-autofollow.mjs` | 168 | 桌面微信自动随访：到期队列 → 生成 → 医生确认发送 → 回复整理 → 归档 | `WechatAutoFollow` L11 | `agent.mjs:825`；hook 在 L17；`server` 暴露 `2697` |
| `server/chat-autofollow-api.mjs` | 11 | `/api/chat-autofollow` 纯 HTTP 分发 | `chatAutoFollowApi` L1 | `agent.mjs:1595` |
| `server/chat-aibot.mjs` | 590 | 企微智能机器人 WSS 通道、单聊/群聊草稿、群自动回复、限流 | `AIBOT_CHANNEL` L16、`WecomAibotChannel` L23、`chatAibotApi` L565 | `agent.mjs:797-799,823,824,2731`；`chat-followups.mjs:20` 注册为连接器 |

### 1.2 渠道与 care（server，5,380 行，含 care）

| 文件 | 行数 | 职责 | 关键导出 | 固定区引用 |
|---|---:|---|---|---|
| `server/wecom.mjs` | 245 | 企微客户联系：凭据、客户同步、绑定、单发/群发任务、回调 | `WeComConnector` L31 | `agent.mjs:743,1596-1616,2692`；回调 `938-952` |
| `server/wecom-directory.mjs` | 373 | 客户/客户群目录、患者匹配建议、备注回写 | `DIRECTORY_SYNC_MS` L8、`WecomDirectory` L14 | 由 `wecom.mjs:51` 持有；`care` tick 调用同步 |
| `server/wechat-exp.mjs` | 264 | 微信历史导出：下载 exe、本地备份、内嵌 wx-cli 桥 | `WechatExpService` L29、`wechatExpApi` L254 | `agent.mjs:801-802,1593,2732` |
| `server/wechat-bridge.mjs` | 11 | 已退役的 macOS 微信桥兼容壳，全部 410 | `WeChatMacBridge` L5 | `agent.mjs:781-794,1618-1621` |
| `server/chat-connectors/registry.mjs` | 128 | 连接器注册表、manifest、能力描述 | `ChatConnectorRegistry` L6 | `chat-followups.mjs:19-21` |
| `server/chat-connectors/visible-delta.mjs` | 14 | OCR 文本连续重叠剥离、gap 标记 | `visibleDelta` L3 | `wechat-reader` 调用 |
| `server/chat-connectors/wechat-export.mjs` | 63 | 微信导出 ZIP/TXT 解析、路径穿越校验、条数上限 | `parseWechatExport` L26、`parseWechatExportBatch` L35 | `chat-followups` 导入 |
| `server/chat-connectors/wechat-reader.mjs` | 380 | 桌面可见窗口读取、头像/顶栏核验、定位、核验发送 | `assertWechatSession` L32、`validateRegion` L35、`WechatReader` L39 | `chat-followups.mjs:19` |
| `server/chat-connectors/wechat-windows.mjs` | 212 | Windows PowerShell 控制、截图、OCR 匹配、头像距离 | `WindowsWechatControl` L87、`AVATAR_BAND` L211、`AVATAR_MATCH_DISTANCE` L212 等 | `wechat-reader` 平台分支 |
| `server/chat-connectors/wecom-aibot-ws.mjs` | 162 | 企微智能机器人 WSS 协议、订阅、ping、重连 | `AIBOT_WS_URL` L10、`toChatMessage` L15、`AibotSocket` L40 | `chat-aibot.mjs:123-131` |
| `server/chat-connectors/wecom-archive.mjs` | 52 | 企微会话存档采集器 HTTP 客户端 | `collectorUrl` L3、`sequence` L10、`WecomArchiveClient` L14 | `chat-followups.mjs:19` |
| `server/chat-connectors/wx-cli.mjs` | 285 | 本地 wx-cli HTTP 客户端、游标分页、消息归一化 | `WxCliClient` L23 | `chat-followups.mjs:19` |
| `server/messaging/gateway.mjs` | 906 | 通用消息网关：飞书/微信 iLink、peer 授权、inbox、串行 pump、发送重试 | `MessageGateway` L30、`messagingApi` L863 | `agent.mjs:729,1635,2709,2729` |
| `server/messaging/transports.mjs` | 316 | 飞书 WS + 微信长轮询、发送、游标/上下文 | `feishuSocket` L6、`wechatOrigin` L18、`MessageTransport` L55 | `gateway.mjs:394-417` |
| `server/messaging/feishu-registration.mjs` | 272 | 飞书设备码注册、1s 轮询、凭据落 vault | `FeishuRegistration` L16 | `gateway.mjs` |
| `server/care/api.mjs` | 55 | `/api/care` 纯 HTTP 分发 | `careApi` L5 | `agent.mjs:1591` |
| `server/care/channels.mjs` | 173 | care 出站渠道：企微客服/客户联系/manual、48h 窗口 | `CHANNEL_IDS` L5、`KF_WINDOW_MS` L8、`CareChannels` L15 | `care/engine.mjs` |
| `server/care/engine.mjs` | 982 | 患者消息流水线、分诊、草稿/告警/自动发送、随访 campaign、客服同步 | `CareEngine` L48 | `agent.mjs:744-750,2711,2733,2754`；`server` 暴露 `2698` |
| `server/care/red-flags.mjs` | 49 | 确定性红旗规则、出站安全筛查 | `SAFETY_REPLY` L18、`AI_DISCLAIMER` L21、`detectRedFlags` L24、`screenOutbound` L43 | `care/engine.mjs`、`chat-aibot.mjs`、`chat-autofollow.mjs` |
| `server/care/store.mjs` | 104 | care schema、设置校验、行映射 | `createCareSchema` L14、`validateSettings` L28、`validatePatientSettings` L66 | `care/engine.mjs` |
| `server/care/tools.mjs` | 136 | 18 个 care/wecom Agent 工具 | `careTools` L25 | `agent.mjs:581,593,627,734` |
| `server/care/triage.mjs` | 100 | 分诊提示、JSON 解析、随访回复抽取 | `triageMessages` L40、`normalizeTriage` L61、`extractFollowup` L86 | `care/engine.mjs`、`chat-autofollow.mjs` |
| `server/care/wecom-api.mjs` | 98 | 最小企微 REST 客户端、token 缓存 | `wecomHint` L15、`WecomApi` L28 | `care/channels.mjs:67` |

### 1.3 前端（3,691 行）

| 文件 | 行数 | 职责 | 导出 / 入口 | 挂载点 |
|---|---:|---|---|---|
| `src/followups.jsx` | 585 | 跨患者随访主页：待办、计划模板、自动随访、聊天随访 | `FollowupsView` L31 | `main.jsx:77,1654-1655` |
| `src/followup-records.jsx` | 681 | 随访待办/记录队列、登记联系结果、补充/更正、问卷跳转 | `FollowupRecords` L18 | `patients.jsx:11,755-763`；`followups.jsx:19,209` |
| `src/followup-surveys-panel.jsx` | 266 | 单患者问卷：下发、复制、电话代填、取消、回收 | `SurveyPanel` L96 | `patients.jsx:12,766-774` |
| `src/chat-followups.jsx` | 237 | 聊天连接设置 + 单患者会话/绑定/草稿/导入 | `ChatConnectionSettings` L17、`ChatFollowupsPanel` L39 | `app-settings.jsx:3,219`；`patients.jsx:7,697`；`followups.jsx:4,208` |
| `src/chat-autofollow.jsx` | 71 | 桌面微信自动随访队列与两个人工检查点 | `WechatOutreachPanel` L9 | `followups.jsx:3,207` |
| `src/care-contacts.jsx` | 186 | 企微客户与群目录、匹配、新建患者、群发 | `ContactFacts` L13、`linkContact` L25、`CareContacts` L31 | `care-inbox.jsx:6`；`wecom-panel.jsx:3` |
| `src/care-inbox.jsx` | 342 | 患者消息工作台 5 个 tab、统计、发送确认、患者设置 | `requestCareTab` L26、`CareInbox` L36、`CampaignPanel` L222、`PatientCareSettings` L314 | `main.jsx:3,1634`；`doctor-agenda.jsx:4`；`patients.jsx:6,851`；`followups.jsx:2`；`patient-attention.jsx:4` |
| `src/care-setup.jsx` | 139 | 企微/患者消息接入向导、跨页 sessionStorage 协议 | `setupProgress` L6、`requestCareSetup` L26、`takeCareSetupRequest` L33、`CareSetup` L43 | `care-inbox.jsx:7`；`workbench-home.jsx:29` |
| `src/care-tasks.jsx` | 149 | 患者“检查与转诊”跟进（固定区 tracking） | `CareTasksPanel` L38 | `patients.jsx:34,643` |
| `src/wecom-panel.jsx` | 78 | 患者档案企微卡片：绑定、疑似客户、任务、结果 | `WeComPanel` L13 | `patients.jsx:8,676` |
| `src/wechat-import.jsx` | 14 | 单患者微信记录导入 | `WechatImportForm` L4 | `chat-followups.jsx:1,139` |
| `src/message-channels.jsx` | 418 | 设置→消息渠道→私聊助手：飞书/微信、授权、二维码 | `MessageChannelSettings` L235 | `app-settings.jsx:12,218` |
| `src/chat-connection-setup.jsx` | 161 | 本机微信/通用服务/企微机器人连接表单 | `ConnectionForm` L6、`AibotConnectionForm` L49、`ServiceConnectionForm` L146 | `chat-followups.jsx:2` |
| `src/questionnaire-editor.jsx` | 151 | 问卷结构编辑器与 payload 构造（无 API） | `emptyQuestion` L4、`buildQuestionnaire` L22、`QuestionnaireEditor` L65、`emptyQuestionnaire` L142 | `patients.jsx:13,1228` |
| `src/feishu-binding.jsx` | 155 | 通用飞书扫码绑定（endpoint 可配置） | `FeishuBinding` L4 | `doctor-notifications.jsx:5`；`message-channels.jsx:3`；`feishu-knowledge-bot.jsx:5` |
| `src/feishu-knowledge-bot.jsx` | 58 | 设置→飞书知识库机器人 | `FeishuKnowledgeBotSettings` L7 | `app-settings.jsx:10,218` |

### 1.4 固定区集成点（只允许薄适配）

| 文件 | 行数 | 与本组相关的职责 | 关键行 |
|---|---:|---|---|
| `server/agent.mjs` | 2804 | 装配、路由、生命周期、bootstrap、shutdown | 258-275、577、693-825、938-952、1024-1111、1591-1635、1654-1674、2073-2104、2160-2163、2201-2245、2701-2754 |
| `server/store.mjs` | 353 | 固定表与 legacy 表建表 | 81-110（`patient_messages` 86、`follow_ups` 88、`reminders` 90、`followup_plans` 102） |
| `server/medical/pending-actions.mjs` | 1003 | `followup_create_propose` 提案与 apply | 489-490、841-861 |
| `server/medical/medical-workspace-domain.mjs` | 270 | 随访/care/企微提示词、外部渠道限制、工具注入 | 28、32、33、150、200-201、221-226 |
| `server/medical/global-assistant.mjs` | — | 跨患者随访工具与提示 | 19、162-171 |
| `src/patients.jsx` | 1311 | 患者两级 tab、沟通与随访分组、badges、随访/消息面板 | 38-39、101-105、630-646、674-854、388-398、490-491、636、691-693 |
| `src/main.jsx` | 2880 | `view=care` / `view=followups` 渲染、URL、侧栏/面包屑 | 3、77、538-542、1278-1283、1567-1601、1634、1654-1655、2372 |
| `src/app-settings.jsx` | 243 | 消息渠道子导航与面板 | 3、10、12、15-20、27-33、162-170、204-221 |
| `src/navigation.js` | 49 | `TOOL_VIEWS`、`VIEW_LABELS`、患者 tab 白名单 | 1、4-10、15-17、19-31、33-48 |
| `src/doctor-agenda.jsx` | 166 | 随访/患者消息 agenda kinds 与跳转 | 10-20、85、88-103、111-116 |
| `src/work-directory.jsx` | — | 资料与工具目录中的随访/患者消息卡片 | 151、170-171、194、205-209、243 |
| `src/command-palette.jsx` | — | 患者消息命令 | 17-21 |
| `src/workbench-home.jsx` | — | 今日待办、企微接入检查项 | 65、240-241、249-250 |
| `src/patient-attention.jsx` | — | `view=care` 跳转 | 62-63 |
| `plugins/legacy-agenda/plugin.mjs` | — | `followup` / `messages` agenda source | 39-68、98-127 |

---

## 2. 数据表与归属

### 2.1 归属规则

- **followup-owned**：只服务随访/聊天随访/care 的表。T7 可以迁入 `followup` 插件迁移；`legacyTables` 声明旧表，禁止 drop。
- **channel-owned**：渠道凭据、连接、绑定、入站/出站任务、目录。T7 迁入 `channel-wecom` / `channel-wechat`；通用消息网关表放 `channel` 基础设施。
- **fixed shared**：跨插件共享、属于患者主档/提醒总线/提案/审计的表。T7 **不迁移、不改字段、不删除**；插件只通过固定服务读写。

### 2.2 全量清单

| 表 | 建表位置 | 主要读 | 主要写 | 归属 | T7 动作 |
|---|---|---|---|---|---|
| `follow_ups` | `store.mjs:88` | `followups.mjs`、`chat-autofollow.mjs`、`legacy-agenda`、`patients` 计数 | `followups.mjs` | **followup**（语义） | `legacyTables` 声明；建表暂留 store；T11 再搬 |
| `followup_plans` | `store.mjs:102` | `followups.mjs` | `followups.mjs` | **followup** | 同上 |
| `followup_applications` | `followups.mjs:26` | `followups.mjs` | `followups.mjs` | **followup** | 插件迁移创建，同名同结构 |
| `followup_creation_requests` | `followups.mjs:27` | `followups.mjs` | `followups.mjs` | **followup** | 同上 |
| `followup_surveys` | `followup-surveys.mjs:273` | `followup-surveys.mjs` | `followup-surveys.mjs` | **followup** | 同上 |
| `chat_connector_plugins` | `chat-followups.mjs:27` | `chat-followups.mjs` | `chat-followups.mjs` | **followup** | 同上 |
| `chat_connections` | `chat-followups.mjs:28` | `chat-followups.mjs`、`wechat-exp.mjs:96`、`chat-aibot`、`plugin-center` | `chat-followups.mjs` | **followup**（配置入口）/ channel 读取 | 表归 followup；channel 通过服务读 |
| `chat_bindings` | `chat-followups.mjs:29` | `chat-followups.mjs`、`chat-aibot.mjs` | `chat-followups.mjs` | **followup** | 同上 |
| `chat_messages` | `chat-followups.mjs:30` | `chat-followups.mjs` | `chat-followups.mjs` | **followup** | 同上 |
| `chat_drafts` | `chat-followups.mjs:31` | `chat-followups.mjs`、`chat-aibot.mjs` | `chat-followups.mjs` | **followup** | 同上 |
| `chat_allocations` | `chat-followups.mjs:33` | `chat-followups.mjs` | `chat-followups.mjs` | **followup** | 同上 |
| `chat_outreach` | `chat-autofollow.mjs:16` | `chat-autofollow.mjs` | `chat-autofollow.mjs` | **followup** | 同上 |
| `chat_aibot_replies` | `chat-aibot.mjs:40-49` | `chat-aibot.mjs` | `chat-aibot.mjs` | **followup**（回复队列） | 同上 |
| `chat_aibot_groups` | `chat-aibot.mjs:53-56` | `chat-aibot.mjs` | `chat-aibot.mjs` | **followup** | 同上 |
| `chat_aibot_group_log` | `chat-aibot.mjs:57-61` | `chat-aibot.mjs` | `chat-aibot.mjs` | **followup** | 同上 |
| `care_settings` | `care/store.mjs:16` | `care/engine.mjs` | `care/engine.mjs` | **followup** | 插件迁移 |
| `care_patient_settings` | `care/store.mjs:17` | `care/engine.mjs`、`wecom-directory.mjs:151` | `care/engine.mjs` | **followup** | 插件迁移 |
| `care_message_state` | `care/store.mjs:18` | `care/engine.mjs` | `care/engine.mjs` | **followup** | 插件迁移 |
| `care_replies` | `care/store.mjs:20` | `care/engine.mjs`、`legacy-agenda` | `care/engine.mjs` | **followup** | 插件迁移 |
| `care_alerts` | `care/store.mjs:22` | `care/engine.mjs`、`legacy-agenda`、`doctorOverview` | `care/engine.mjs` | **followup** | 插件迁移 |
| `care_campaigns` | `care/store.mjs:24` | `care/engine.mjs` | `care/engine.mjs` | **followup** | 插件迁移 |
| `wecom_contacts` | `wecom.mjs:42`（+`wecom-directory.mjs:20-21` ALTER data） | `wecom.mjs`、`wecom-directory.mjs` | 同左 | **channel-wecom** | 插件迁移；`ALTER` 兼容保留 |
| `wecom_bindings` | `wecom.mjs:43` | `wecom.mjs`、`wecom-directory.mjs`、`care/engine.mjs:192` | `wecom.mjs` | **channel-wecom** | 插件迁移 |
| `wecom_tasks` | `wecom.mjs:44` | `wecom.mjs` | `wecom.mjs` | **channel-wecom** | 插件迁移 |
| `wecom_events` | `wecom.mjs:45` | `wecom.mjs` | `wecom.mjs` | **channel-wecom** | 插件迁移 |
| `wecom_groups` | `wecom-directory.mjs:23` | `wecom-directory.mjs` | `wecom-directory.mjs` | **channel-wecom** | 插件迁移 |
| `wecom_group_tasks` | `wecom-directory.mjs:24` | `wecom-directory.mjs` | `wecom-directory.mjs` | **channel-wecom** | 插件迁移 |
| `wecom_directory_state` | `wecom-directory.mjs:25` | `wecom-directory.mjs` | `wecom-directory.mjs` | **channel-wecom** | 插件迁移 |
| `message_channels` | `messaging/gateway.mjs:63` | `gateway.mjs` | `gateway.mjs` | **channel 基础设施** | T7.2 建 `channel` 基础插件或 host 服务；不归 followup |
| `message_peers` | `messaging/gateway.mjs:64` | `gateway.mjs` | `gateway.mjs` | **channel 基础设施** | 同上 |
| `message_inbox` | `messaging/gateway.mjs:65` | `gateway.mjs` | `gateway.mjs` | **channel 基础设施** | 同上 |
| `patients` | `store.mjs:85` | 全部 | `patients.mjs` | **fixed** | 只读/服务调用 |
| `patient_messages` | `store.mjs:86` | `patients.mjs`、`care/engine.mjs`、`followups.mjs`、`patient-brief.mjs`、`legacy-agenda` | `patients.mjs`（intake） | **fixed shared** | 不迁移；channel 通过 `patients.ingest` 写入 |
| `reminders` | `store.mjs:90` | `followups.mjs`、`followup-surveys.mjs`、`chat-autofollow.mjs`、`risk-rules.mjs`、`doctor-notifications.mjs`、`extensions.mjs`、`patient-brief.mjs`、`patients.mjs`、`legacy-agenda` | `followups.mjs`、`risk-rules.mjs`、`doctor-notifications.mjs`、`extensions.mjs` | **fixed shared（提醒总线）** | 不迁移；followup 只写 `kind='followup'` |
| `appointments` | `medical/patient-schedule.mjs:24` | `patient-schedule.mjs`、`extensions.mjs`、`doctorOverview` | `patient-schedule.mjs` | **fixed** | 不迁移；agenda 的 visit 来源不动 |
| `care_tasks` | `store.mjs:92` | `care-tasks.mjs`、`legacy-agenda` | `care-tasks.mjs` | **fixed**（检查与转诊） | 不迁移；仍在 tracking tab |
| `pending_actions` | `store.mjs:108` | 全部提案 | `pending-actions.mjs` | **fixed shared** | 不迁移；插件通过 `pending.propose` 注册提案类型 |
| `risk_alerts` | `store.mjs:103` | `risk-rules.mjs`、`patients.jsx`、agenda | `risk-rules.mjs` | **fixed** | 不迁移 |
| `agent_credentials` | `core/oauth.mjs:39-41` | `CredentialVault` | `CredentialVault` | **fixed** | 不迁移；渠道密钥继续走 vault |
| `audit` / `event_log` / `meta` | `store.mjs:82-83,110` | 全站 | 全站 | **fixed** | 不迁移 |

### 2.3 三张易误判的表

#### `reminders`（固定区共享）

- 建表在 `store.mjs:90`；随访只负责插入 `kind='followup'`（`followups.mjs:543`），并在 `reminderPage/reminders/ackReminder/completeReminder` 里读改（`665/699/772`）。
- 风险规则、医生提醒、扩展、患者摘要、患者列表、agenda 都直接读它。若随插件迁移，必须把这些读取方全部改成插件服务调用，且 agenda snapshot（`followup: 1`）仍要成立。
- **决定**：`reminders` 永远留在固定区，作为“提醒总线”；`followup` 只拥有 `kind='followup'` 的语义和写入格式，不拥有表。这样 `/api/reminders` 路由可以保持固定，`followup.test.mjs:99` 不会受影响。
- 需要给 `kind` 增加所有权约定：`followup`、`risk`、`doctor-notification`、`extension` 等；新增 kind 必须走固定区 review，插件不得写别人的 kind。

#### `patient_messages`（固定区共享）

- 建表在 `store.mjs:86`；`patients.ingest` 是唯一 intake 写入口（`patients.mjs`），`care/engine.mjs` 写处理状态和出站副本，`followups.mjs:520` 只读未处理消息做摘要，`patient-brief` 与 agenda 也读。
- 渠道插件只应调用 `patients.ingest(messages, { fallbackChannel })`，不得直接 INSERT；这样去重、患者匹配、`processed` 状态保持单一写者。
- **决定**：表留在固定区；`channel` 是“生产者”，`followup/care` 是“消费者”，都不是 owner。

#### `appointments`（固定区）

- 建表在 `medical/patient-schedule.mjs:24`，路由 `/api/patients/:id/appointments` 与 `/api/appointments/:id` 在 `agent.mjs:2120-2125`，属复诊预约，不属随访触达。
- `doctorOverview` 的 `visit` agenda kind 来自它；`followup` 插件只读 agenda 合并结果，不直接写。
- **决定**：不迁移；T7 的任何子任务不得把 `appointments` 放进 `followup` 的 `legacyTables`。

### 2.4 凭据键

| 键 | 所属 | 写入 | 说明 |
|---|---|---|---|
| `wecom:corp:v1` | channel-wecom | `wecom.mjs:82` | corpId/corpSecret/callbackToken/aesKey；env 回退 `MEDICAL_WECOM_*` |
| `care:channels:v1` | followup | `care/channels.mjs:35-47` | 企微客服/应用 secret、openKfId、agentId、kfLink |
| `message-channel:<id>` | channel 基础设施 | `gateway.mjs:307` | 飞书 appSecret、微信 botToken 等 |
| `message-feishu-registration` | channel 基础设施 | `feishu-registration.mjs:5` | 设备码一次性凭据 |
| `chat:<channel>` | followup | `chat-followups.mjs:68,115` | 连接器 token、微信导出桥 token |

统一要求：只存 `CredentialVault`（AES-256-GCM、`agent_credentials`）；公开状态只返回布尔/掩码；`corpId`/`openKfId`/`agentId` 是否明文需在 T7.2 统一为“非秘密标识可明文，secret 永不返回”。

---

## 3. HTTP 路由

### 3.1 路由归属原则

1. **基线不可变**：`followup.test.mjs` 只用 `/api/agent/run`、`/api/sessions/:id`、`/api/pending-actions*`、`/api/doctor/overview`、`/api/reminders`，这些路径与响应必须原样保留。`agenda.test.mjs` 只用 `/api/doctor/overview`。
2. **随访私有路由**迁入 `followup` 的 `legacyApiPaths`；**提醒总线** `/api/reminders` 留固定区，内部调用 `followup` 服务；**患者主档** `/api/patients/:id` 留固定区，只把 `/followups*`、`/followup-records`、`/followup-surveys*` 子路由交给插件。
3. **渠道路由**迁入 `channel-wecom` / `channel-wechat`；`/api/wecom/callback` 暂留固定区（见 3.6）。
4. **`/api/doctor/overview` 留固定区**，但 agenda source 由插件提供；固定区只做聚合与错误隔离。

### 3.2 随访核心路由

| Method | Path | Handler | 前端调用方 |
|---|---|---|---|
| GET | `/api/followup-plans` | `followups.listPlans()` L1654 | `src/followups.jsx:61` |
| POST | `/api/followup-plans` | `followups.createPlan()` L1656 | `src/followups.jsx:118` |
| DELETE | `/api/followup-plans/:id` | `followups.removePlan()` L1658-1664 | `src/followups.jsx:156` |
| GET | `/api/followups/overview` | `followups.overviewPage()` L1665-1674 | `src/followups.jsx:63,70` |
| GET | `/api/reminders` | `followups.reminderPage()` L2073-2081 | `src/followup-records.jsx:61`；`src/patients.jsx:191` |
| POST | `/api/reminders/:id/addendum` | `followups.addContactAddendum()` L2082 | `src/followup-records.jsx:91` |
| POST | `/api/reminders/:id/complete` | `followups.completeReminder()` + `risks.evaluatePatient` L2084-2097 | `src/followup-records.jsx:118` |
| POST | `/api/reminders/:id/ack` | `followups.ackReminder()` L2098-2104 | 无直接 UI（Agenda/内部） |
| POST | `/api/patients/:id/followup-records` | `followups.recordContact()` + risk L2160-2163 | `src/followup-records.jsx:117` |
| GET | `/api/patients/:id/followup-surveys` | `surveys.list()` L2201-2202 | `src/followup-surveys-panel.jsx:123`；`src/followup-records.jsx:136` |
| POST | `/api/patients/:id/followup-surveys/:surveyId/send` | `surveys.send()` L2203-2205 | `src/followup-surveys-panel.jsx:180` |
| POST | `/api/patients/:id/followup-surveys/:surveyId/collect` | `surveys.collect()` + risk L2206-2209 | `src/followup-surveys-panel.jsx:256` |
| POST | `/api/patients/:id/followup-surveys/:surveyId/cancel` | `surveys.cancel()` L2211 | `src/followup-surveys-panel.jsx:233` |
| POST | `/api/patients/:id/followup-surveys/:surveyId/ai-parse` | `surveys.aiParse()` L2212 | 无直接 UI（Agent/内部） |
| GET | `/api/patients/:id/followups` | `{ jobs: followups.list() }` L2215-2217 | `src/patients.jsx:222` |
| POST | `/api/patients/:id/followups` | `followups.create()` L2218-2219 | `src/patients.jsx:1142` |
| POST | `/api/patients/:id/followups/apply` | `followups.applyTemplate()` L2220-2229 | `src/followups.jsx:100` |
| PATCH | `/api/patients/:id/followups/:jobId` | `followups.row/update()` L2230-2239 | `src/followups.jsx:139`；`src/patients.jsx:816,1137` |
| DELETE | `/api/patients/:id/followups/:jobId` | `followups.remove()` L2240-2243 | `src/followups.jsx:147`；`src/patients.jsx:835` |

### 3.3 Chat-followups 路由（`chat-followups-api.mjs`）

| Method | Path | Handler | 前端调用方 |
|---|---|---|---|
| POST | `/api/chat-followups/plugins` | `installPlugin` L5 | `src/plugin-center.jsx:31` |
| DELETE | `/api/chat-followups/plugins/:id` | `removePlugin` L6 | `src/plugin-center.jsx:38` |
| GET | `/api/chat-followups/settings` | `settings` L7 | `src/chat-followups.jsx:19`；`src/plugin-center.jsx:16,72` |
| POST | `/api/chat-followups/connections/:channel` | `save` L8 | `src/chat-connection-setup.jsx:26,152,159` |
| POST | `/api/chat-followups/connections/:channel/rescan` | `resetCursor` L11 | 无直接 UI（设置/维护） |
| POST | `/api/chat-followups/connections/:channel/connect` | `connect` L12 | `src/chat-connection-setup.jsx:20,40`；`src/plugin-center.jsx:74` |
| POST | `/api/chat-followups/connections/:channel/test` | `test` L13 | `src/chat-connection-setup.jsx:13,39` |
| POST | `/api/chat-followups/connections/:channel/sync` | `sync` L14 | `src/chat-followups.jsx:160` |
| POST | `/api/chat-followups/connections/:channel/cancel` | `cancel` L15 | `src/chat-followups.jsx:138` |
| GET | `/api/chat-followups/patients/:id` | `list` L17 | `src/chat-followups.jsx:133` |
| GET | `/api/chat-followups/conversations` | `conversations` L18 | `src/chat-followups.jsx:189` |
| POST | `/api/chat-followups/imports/preview` | `previewImport` L19 | `src/chat-followups.jsx:64,99`；`src/wechat-import.jsx:9` |
| POST | `/api/chat-followups/imports/match` | `matchImportNames` L20 | `src/chat-followups.jsx:77` |
| POST | `/api/chat-followups/imports` | `importExport` L21 | `src/chat-followups.jsx:97,100`；`src/wechat-import.jsx:7` |
| POST | `/api/chat-followups/preview` | `preview` L22 | `src/chat-followups.jsx:189` |
| POST | `/api/chat-followups/contacts` | `wechatContacts` L23 | `src/chat-followups.jsx:189` |
| POST | `/api/chat-followups/bindings` | `bind` L24 | `src/chat-followups.jsx:185` |
| DELETE | `/api/chat-followups/bindings/:id` | `unbind` L25 | `src/chat-followups.jsx:163` |
| POST | `/api/chat-followups/bindings/:id/send` | `sendToBinding` L26 | `src/chat-followups.jsx:174` |
| POST | `/api/chat-followups/bindings/:id/avatar` | `refreshAvatar` L27 | `src/chat-followups.jsx:162` |
| POST | `/api/chat-followups/assign` | `assign` L28 | `src/chat-followups.jsx:145` |
| GET | `/api/chat-followups/drafts/:id/sources` | `evidence` L30 | `src/chat-followups.jsx:231` |
| POST | `/api/chat-followups/drafts/:id/save` | `updateDraft` L32 | `src/chat-followups.jsx:232` |
| POST | `/api/chat-followups/drafts/:id/summarize` | `summarize` L33 | `src/chat-followups.jsx:232` |
| POST | `/api/chat-followups/drafts/:id/archive` | `archiveDraft` L34 | `src/chat-followups.jsx:233` |

### 3.4 Chat-autofollow / Chat-aibot

| Method | Path | Handler | 前端调用方 |
|---|---|---|---|
| GET | `/api/chat-autofollow/queue` | `queue` L5 | `src/chat-autofollow.jsx:11` |
| POST | `/api/chat-autofollow/:jobId/generate` | `generate` L6 | `src/chat-autofollow.jsx:19,52` |
| POST | `/api/chat-autofollow/:jobId/send` | `send` L7 | `src/chat-autofollow.jsx:57` |
| POST | `/api/chat-autofollow/:jobId/record` | `record` L8 | `src/chat-autofollow.jsx:61` |
| POST | `/api/chat-autofollow/:jobId/archive` | `archive` L9 | `src/chat-autofollow.jsx:66` |
| GET | `/api/chat-aibot/replies` | `channel.replies` L571 | `src/chat-followups.jsx:133` |
| POST | `/api/chat-aibot/replies/:id/send` | `sendReply` L573 | `src/chat-followups.jsx:221` |
| POST | `/api/chat-aibot/replies/:id/dismiss` | `dismissReply` L575 | `src/chat-followups.jsx:222` |
| GET | `/api/chat-aibot/groups` | `groupPanel` L577 | `src/chat-connection-setup.jsx:74` |
| POST | `/api/chat-aibot/groups` | `saveGroup` L579 | `src/chat-connection-setup.jsx:107` |
| DELETE | `/api/chat-aibot/groups/:id` | `removeGroup` L581 | `src/chat-connection-setup.jsx:121,127` |
| GET | `/api/chat-aibot/groups/:id/log` | `groupLog` L583 | 无直接 UI（连接设置详情） |
| POST | `/api/chat-aibot/group-replies/:id/send` | `sendGroupReply` L585 | `src/chat-connection-setup.jsx:141` |
| POST | `/api/chat-aibot/group-replies/:id/dismiss` | `dismissGroupReply` L587 | `src/chat-connection-setup.jsx:142` |

### 3.5 Care 路由

| Method | Path | Handler | 前端调用方 |
|---|---|---|---|
| POST | `/api/care/education-broadcast/propose` | `pending.propose` L12-16 | `src/education-materials.jsx:54` |
| GET | `/api/care/overview` | `care.overview()` L19 | `src/care-inbox.jsx:60` |
| GET | `/api/care/inbox` | `care.inbox()` L20 | `src/care-inbox.jsx:57` |
| GET | `/api/care/replies` | `care.replies()` L21 | `src/care-inbox.jsx:57`；`src/appointments.jsx:43` |
| POST | `/api/care/replies` | `care.createReply()` L22-24 | `src/appointments.jsx:58` |
| GET | `/api/care/alerts` | `care.alerts()` L26 | `src/care-inbox.jsx:57` |
| GET | `/api/care/campaigns` | `care.campaigns()` L27 | `src/care-inbox.jsx:226` |
| POST | `/api/care/campaigns` | `care.createCampaign()` L28 | 无直接 UI（Agent/内部） |
| GET | `/api/care/settings` | `care.publicSettings()` L29 | `src/care-inbox.jsx:52,57`；`src/care-setup.jsx:50`；`src/workbench-home.jsx:240-241` |
| PUT | `/api/care/settings` | `care.saveSettings()` L30 | `src/care-inbox.jsx:131` |
| POST | `/api/care/ingest` | `care.ingest()` L31 | 无直接 UI（intake/测试） |
| POST | `/api/care/sync` | `care.syncKf()` L32 | `src/care-inbox.jsx:106` |
| POST | `/api/care/settings/test` | `care.testConnection()` L34 | `src/care-inbox.jsx:268`；`src/care-setup.jsx:87` |
| GET | `/api/care/settings/kf-accounts` | `care.kfAccounts()` L35 | 无直接 UI |
| POST | `/api/care/settings/kf-link` | `care.kfLink()` L36 | `src/care-setup.jsx:100` |
| GET | `/api/care/patients/:id` | `care.patientThread()` L37 | 无直接 UI（患者线程在 workbench） |
| GET/PUT | `/api/care/patients/:id/settings` | `patientSettings` / `savePatientSettings` L38-40 | `src/care-inbox.jsx:319,324` |
| POST | `/api/care/messages/:id/process` | `care.processMessage()` L42-43 | `src/care-inbox.jsx:127` |
| POST | `/api/care/messages/:id/mark` | `care.markMessage()` L44 | `src/care-inbox.jsx:128` |
| POST | `/api/care/messages/:id/assign` | `care.assignMessage()` L45 | `src/care-inbox.jsx:126` |
| PUT | `/api/care/replies/:id` | `care.updateReply()` L47 | `src/care-inbox.jsx:121`；`src/appointments.jsx:137` |
| POST | `/api/care/replies/:id/send` | `care.sendReply()` L48-49 | `src/care-inbox.jsx:139` |
| POST | `/api/care/replies/:id/discard` | `care.discardReply()` L50 | `src/care-inbox.jsx:123` |
| POST | `/api/care/alerts/:id/:action` | `care.updateAlert()` L52 | `src/care-inbox.jsx:119` |
| POST | `/api/care/campaigns/:id/:action` | `care.campaignAction()` L53 | `src/care-inbox.jsx:231` |

### 3.6 企业微信路由

| Method | Path | Handler | 前端调用方 |
|---|---|---|---|
| GET/POST | `/api/wecom/callback` | `wecom.callback()` L938-952，公开、guard 前 | 企业微信服务器（无本地 UI） |
| GET | `/api/wecom/status` | `wecom.status()` L1596 | 无直接 UI |
| GET | `/api/wecom/contacts` | `directory.contacts()` L1597 | `src/care-contacts.jsx:46`；`src/wecom-panel.jsx:25` |
| GET | `/api/wecom/directory` | `directory.status()` L1598 | 无直接 UI |
| POST | `/api/wecom/directory/sync` | `directory.sync()` L1599 | `src/care-contacts.jsx:61` |
| GET | `/api/wecom/groups` | `directory.groups()` L1600 | `src/care-contacts.jsx:46` |
| GET | `/api/wecom/groups/:chatId` | `directory.group()` L1601 | `src/care-contacts.jsx:145,147` |
| GET | `/api/wecom/patients/:patientId` | `directory.patient()` L1602 | `src/wecom-panel.jsx:19` |
| POST | `/api/wecom/group-tasks` | `directory.groupDraft()` L1603 | `src/care-contacts.jsx:159` |
| POST | `/api/wecom/group-tasks/:id/submit` | `directory.groupSubmit()` L1604-1605 | `src/care-contacts.jsx:160` |
| POST | `/api/wecom/group-tasks/:id/refresh` | `directory.groupRefresh()` L1606 | `src/care-contacts.jsx:145` |
| POST | `/api/wecom/sync` | `wecom.sync()` L1608 | 无直接 UI（目录自动同步） |
| GET | `/api/wecom/bindings` | `wecom.bindings()` L1609 | 无直接 UI |
| POST | `/api/wecom/bindings` | `directory.link()` L1610 | `src/care-contacts.jsx:26` |
| DELETE | `/api/wecom/bindings/:id` | `wecom.unbind()` L1611 | `src/care-contacts.jsx:133`；`src/wecom-panel.jsx:45` |
| GET | `/api/wecom/tasks` | `wecom.tasks()` L1612 | `src/wecom-panel.jsx:19` |
| POST | `/api/wecom/tasks` | `wecom.draft()` L1613 | `src/wecom-panel.jsx:69` |
| POST | `/api/wecom/tasks/:id/submit` | `wecom.submit()` L1614-1615 | `src/wecom-panel.jsx:72` |
| POST | `/api/wecom/tasks/:id/refresh` | `wecom.refresh()` L1615-1616 | `src/wecom-panel.jsx:73` |

### 3.7 微信 / 导入 / 通用消息

| Method | Path | Handler | 前端调用方 |
|---|---|---|---|
| GET | `/api/wechat/status` | 固定区静态 retired L1618-1619 | 无 UI（遗留） |
| POST | `/api/wechat/read` | 固定区抛 410 L1620-1621 | 无 UI（遗留） |
| POST | `/api/wechat/send` | 固定区抛 410 L1620-1621 | 无 UI（遗留） |
| GET | `/api/wechat-exp/status` | `status()` L259 | `src/plugin-center.jsx:45,49` |
| POST | `/api/wechat-exp/download` | `downloadTool()` L260 | `src/plugin-center.jsx:58` |
| POST | `/api/wechat-exp/backup` | `backup()` L261 | `src/plugin-center.jsx:63-64` |
| POST | `/api/wechat-exp/refresh` | `contacts()` L262 | 无直接 UI |
| GET | `/api/message-channels` | `gateway.settings()` L866 | `src/message-channels.jsx:242,246` |
| PUT | `/api/message-channels` | `gateway.save()` L867 | `src/message-channels.jsx:76` |
| POST | `/api/message-channels/feishu-binding` | `startFeishuBinding()` L869 | `src/message-channels.jsx`（FeishuBinding） |
| DELETE | `/api/message-channels/feishu-binding` | `feishuBinding.cancel()` L875 | `src/message-channels.jsx`（FeishuBinding） |
| POST | `/api/message-channels/feishu-binding/status` | `feishuBinding.poll()` L881 | `src/message-channels.jsx`（FeishuBinding） |
| POST | `/api/message-channels/qrcode` | `startQr()` L888 | `src/message-channels.jsx:366` |
| POST | `/api/message-channels/qrcode-status` | `pollQr()` L890 | `src/message-channels.jsx:267` |
| POST | `/api/message-channels/qrcode-cancel` | `cancelQr()` L892 | `src/message-channels.jsx:391` |
| PUT | `/api/message-channels/peers/:id` | `authorize()` L894 | `src/message-channels.jsx:161` |
| POST | `/api/message-channels/deliveries/:id` | `retry()` L896 | `src/message-channels.jsx:216` |
| DELETE | `/api/message-channels/:id` | `remove()` L902 | `src/message-channels.jsx:130` |

### 3.8 基线路径契约（不可改）

`tests/baseline/followup.test.mjs` 的完整链路：

1. `POST /api/agent/run` → 模型调用 `followup_create_propose`；
2. `GET /api/sessions/:sessionId` → 断言 `tool.complete.payload.tool === "followup_create_propose"`；
3. `GET /api/pending-actions?type=followup-create&patientId=...` → 找到 `status=pending`；
4. `POST /api/pending-actions/:id/confirm` → `applied.name`、`applied.patientId` 正确；
5. `GET /api/doctor/overview?limit=100` → item `kind=followup`、`id` 前缀 `reminder:`、`title` 为 `随访：${name}`、`patientName` 正确；
6. `GET /api/reminders?patientId=...&status=pending` → 存在同名 reminder。

因此：
- `pending-actions.mjs` 的 `followup-create` 分支在 T7 期间**必须保留**，可改为调用 `ctx.service("followup").create`，但不得改 `applied` 形状。
- `/api/reminders` 必须留在固定区，且 `reminderPage` 的 `counts/total/reminders` 形状不变。
- agenda source 的 `id` 必须继续是 `reminder:<uuid>`，`kind` 必须继续是 `followup`；`legacy-agenda` 的 source 顺序/权重不变。
- `agenda.json` 快照的 `counts.followup=1`、`counts.messages=3` 不能变；T7.6 隐藏入口也不得删除既有 agenda item。

---

## 4. Agent 工具、提示词、技能

### 4.1 工具清单

| 工具 | 注册位置 | 实现 | 读/写 | 迁移归属 |
|---|---|---|---|---|
| `followup_create_propose` | `pending-actions.mjs:841-861`；`agent.mjs:734` | `pending.propose({type:"followup-create"})` | 只写 `pending_actions` | fixed 提案 + followup apply |
| `followups_overview` | `global-assistant.mjs:162-171`；`medical-workspace-domain.mjs:221-226` | `followups.overview()` | 只读 | followup |
| `care_overview` | `care/tools.mjs:43-45` | `care.overview()` | 只读 | followup |
| `care_inbox` | `47-51` | `care.inbox()` | 只读 | followup |
| `care_patient_thread` | `53-58` | `care.patientThread()` | 只读 | followup |
| `care_alerts` | `60-62` | `care.alerts()` | 只读 | followup |
| `care_campaigns` | `64-66` | `care.campaigns()` | 只读 | followup |
| `care_settings_get` | `68-70` | `publicSettings/patientSettings` | 只读 | followup |
| `care_alert_update` | `72-74` | `care.updateAlert()` | 写告警状态 | followup |
| `care_message_mark` | `76-78` | `care.markMessage()` | 写消息状态 | followup |
| `care_reply_draft` | `80-82` | `care.createReply()` | 写草稿 | followup |
| `care_send_propose` | `84-87` | `pending.propose("care-message")` | 提案 | followup + fixed |
| `care_campaign_propose` | `89-96` | `pending.propose("care-campaign")` | 提案 | followup + fixed |
| `care_settings_propose` | `98-102` | `pending.propose("care-settings")` | 提案 | followup + fixed |
| `wecom_customers` | `104-112` | `directory.contacts()` | 只读 | channel-wecom |
| `wecom_patient_contacts` | `114-116` | `directory.patient()` | 只读 | channel-wecom |
| `wecom_groups` | `118-120` | `directory.group(s)` | 只读 | channel-wecom |
| `wecom_sync` | `122-124` | `directory.sync()` | 写目录 | channel-wecom |
| `wecom_bind_propose` | `126-130` | `pending.propose("care-bind")` | 提案 | channel-wecom + fixed |
| `wecom_group_message_propose` | `132-134` | `pending.propose("care-group-message")` | 提案 | channel-wecom + fixed |

### 4.2 提案类型

- `followup-create`：`TYPES` 固定区类型，apply 在 `pending-actions.mjs:489-490`。T7 迁移后 apply 改为 `ctx.service("followup").create(...)`，仍返回 `applied` 患者随访对象。
- `care-message` / `care-campaign` / `care-settings` / `care-bind` / `care-group-message` / `care-education-broadcast`：由 `CareEngine.applyProposal`（`engine.mjs:808-856`）处理。T7 迁到 followup 插件后，提案类型仍由固定 `pending_actions` 存储，apply handler 由插件注册（`pluginHost.proposalHandler`）。
- 安全约束：`care_settings_propose` 禁止在 payload 中带 `channels`（`care/engine.mjs:756`），插件迁移不得放宽。
- 外部渠道来源（`workspace.channelSource`）禁止 `proposal_confirm`，抛 `CHANNEL_REVIEW_REQUIRED` 403（`medical-workspace-domain.mjs:200-201`）；T7.2 后仍由固定区执行。

### 4.3 提示词

- `medical-workspace-domain.mjs:28`：私域患者管理总则（care/followup/企微工具、只提议案、不发患者诊断/处方/剂量）。
- `medical-workspace-domain.mjs:32`：企微客户/群、6 小时同步、匹配只是线索、无私聊存档。
- `medical-workspace-domain.mjs:33`：医生随访偏好走 `doctor_memory_save`。
- `medical-workspace-domain.mjs:150`：外部渠道回复限制。
- `medical-workspace-domain.mjs:200-201`：外部来源禁止 `proposal_confirm`。
- `global-assistant.mjs:8,14,19`：跨患者“安排随访”、`*_propose`、`followup_create_propose` 只提醒医生本人。
- 模块内起草提示：`chat-followups.mjs:556`、`chat-autofollow.mjs:79`、`chat-aibot.mjs:241`。
- **T7 迁移方式**：插件 `prompt` 片段只能做“增量注入”，不能复制固定区整段；固定区段落保留，插件删除对应工具时同步删除段落。T7.1 先给 host 增加 prompt 片段排序/去重测试。

### 4.4 技能

- 无 `skills/*followup*`、`*wecom*`、`*wechat*`、`*care*` 目录。
- 只有 `skills/discharge-summary/SKILL.md` 与 `skills/knowledge-organizer/SKILL.md` 出现“随访”字样（字段/文书语义），不属本插件技能。
- **决定**：T7 不新增技能；`chat-aibot` 的 `skillBodies` 继续读固定 skills 服务。若后续要加“随访话术”技能，必须作为 followup 插件资产，不得写进固定 `skills/`。

---

## 5. 定时任务、后台循环与生命周期

### 5.1 全量后台活动

| 组件 | 类型/周期 | 启动 | 停止/清理 | 调用方 | 并发/恢复要点 |
|---|---|---|---|---|---|
| `FollowUpManager` | `setInterval` 1s | `start()` `followups.mjs:471` | `stop()` 476；`drain()` 480 | `agent.mjs:2705/2725/2753` | 每 tick 最多 10 条；`inFlight`；重启把 `running` 改 `paused`（30-43），不重放 |
| `FollowUpSurveys` | 无 timer | — | — | followup tick / aibot / 路由 | 无锁；`send` 可重发；`collect` 依赖 `recordContact` 幂等 |
| `ChatFollowups` | `setInterval` 30s | `start()` 574 | `stop()` 657 | `agent.mjs:2710/2730` | `ticking` 重入锁、per-channel `active`、`pendingAI`；游标/预览内存态重启丢失 |
| `WechatAutoFollow` | 事件 hook | 构造 L17 | 无 | `ChatFollowups.runSync:460` | 无锁；`archive` 用 `recordContact` 幂等 |
| `WecomAibotChannel` | `setInterval` 10s + WSS | `start()` 89（**listen 前**） | `stop()` 95 | `agent.mjs:824/2731` | `reconcile` 按 `revision:secret` 签名重建 socket；`drafting` 去重；断线退避 1s→30s |
| `WechatExpService` | `setInterval` 10s + 本地 HTTP | `start()` 238（**listen 前**） | `stop()` 245 | `agent.mjs:802/2732` | `reconcile` 按 `revision:secret`；**`stopBridge` 从未赋值，内嵌 server 从不 close**（已知 bug） |
| `WeComConnector` | 无 timer | — | 无 `stop` | 回调/请求 | `syncing` 单飞；`submitting`→`unknown` 恢复 |
| `WecomDirectory` | 无自有 timer；6h `due()` | — | — | `care` tick；`/api/wecom/directory/sync` | `running` 单飞；游标环上限 1000 |
| `CareEngine` | `setInterval` 20s | `start()` 969 | `stop()` 976；`drain()` 981 | `agent.mjs:2711/2733/2754` | `ticking/again`；`sending`→`unknown`；kf 串行链；`stop` 不 abort pendingWork |
| `CareEngine` kf | 60s + 退避至 15min | `runOnce` | — | tick | `kf.running` 串行 |
| `CareEngine` 成员任务 | 10min / 7d 窗口 | `runOnce` | — | tick | 每行 `checkedAt` |
| `MessageGateway` | 事件驱动 | `start()` 373 | `stop()` 754 | `agent.mjs:2709/2729` | 每通道 `MessageTransport`；inbox 串行 pump；发送去重/重试 |
| `MessageTransport` | 微信 45s 长轮询 / 飞书 WS | `start()` 153 | `stop()` 308 | gateway | cursor 最后推进；失败退避 1s→30s |
| `FeishuRegistration` | 1s 轮询（仅进行中） | `start()` 256 | `stop()` 263 | gateway | `starting` 单飞；`slow_down` interval+5 |
| `MedicalScheduler` | 1s（通用） | `start()` 248 | `stop()` 253；`drain()` 257 | `agent.mjs:2702/2721/2749` | 与随访无关；不要误把 followup 任务塞进 `scheduled_jobs` |

### 5.2 当前启动/关闭顺序（`agent.mjs`）

启动：
1. `wecomAibot.start()` L824（listen 前）
2. `wechatExp.start(chatFollowups)` L802（listen 前）
3. `server.once("listening")` L2701：`scheduler.start` 2702 → `followups.start` 2705 → `messageGateway.start` 2709 → `chatFollowups.start` 2710 → `care.start` 2711
4. HTTP server 开始接受请求

关闭：
1. `guidelines.stopStatusQueries` 2717、`personalRegression.stop` 2719、`workspaces.stopping` 2720、`scheduler.stop` 2721、`paddleLocal.stop` 2722、`workspaces.*` 2723-2724
2. `followups.stop` 2725、`doctorNotifications.stop` 2726、`knowledgeBot.*` 2727-2728、`messageGateway.stop` 2729、`chatFollowups.stop` 2730、`wecomAibot.stop` 2731、`wechatExp.stop` 2732、`care.stop` 2733
3. `extensions.stop` 2734、intake/trial/knowledge 任务 2740-2743
4. `server.closeAllConnections` 2746、`server.close` 2747
5. `scheduler.drain` 2749、`followups.drain` 2753、`care.drain` 2754、`sockets.close` 2766、`store.close` 2767

### 5.3 迁移后的生命周期契约

- `followup` 的 start 必须晚于 `channel-wecom` / `channel-wechat` 的 start（依赖顺序）；stop 反向。
- `followup` 的 start 只安装 timer/订阅，不等待远端连接；渠道连接失败不应阻塞监听。
- `followup.stop` 必须：清 interval、abort 进行中的发送、`await drain`；`ChatFollowups.stop` 的语义（取消所有 active/pendingAI）保持。
- `channel-wecom.stop` 必须：清 10s reconcile、close AibotSocket、关本地 bridge（修复 `stopBridge`）、并等待 socket close；`WeComConnector` 增加 `stop()`（无 timer，主要是清 token/client 缓存）。
- `channel-wechat.stop` 必须：清 10s reconcile、关 9101 bridge、等待备份子进程退出（目前 `spawnCapture` 的 kill 清理需补）。
- `care` 作为 followup 子模块，start/stop 由 followup 统一编排；不再由 `agent.mjs` 逐个调用。
- `medicalScheduler` 不接管 followup；如果未来要持久化“计划任务”，必须走 `scheduled_jobs` 的通用接口，不能复制 `follow_ups`。

---

## 6. 前端页面、患者 tab、设置、导航、agenda

### 6.1 页面与导航

| 入口 | 位置 | 现状 | 迁移后 |
|---|---|---|---|
| `view=followups` | `main.jsx:1654-1655` | 固定 import `FollowupsView`，`onSettings` 先 `navigate("settings")` 再 `replaceState("?view=settings&settingsTab=followup")` | followup 插件 `legacyViews` 提供组件；保留同一 URL 与 settings 跳转时序 |
| `view=care` | `main.jsx:1634` | 固定 import `CareInbox`，`onOpenPatient` 打开 `tab=messages` | followup 插件 `legacyViews`；URL 不变 |
| 侧栏 | `main.jsx:1567-1570` | 仅 patients/agenda/knowledge；care/followups 在“资料与工具” | 不加主导航；仍在 `TOOL_VIEWS` |
| 面包屑 | `main.jsx:1601` | `资料与工具 › VIEW_LABELS[view]` | 保留；`VIEW_LABELS` 不移交 |
| 资料与工具目录 | `work-directory.jsx:170-171` | `care` / `followups` 卡片 | 改为插件 `tools.directory` 贡献；T7.6 可隐藏 followup 卡片 |
| 命令面板 | `command-palette.jsx:17-21` | `care` 命令 | 保留；followup 命令可后续加 |
| 工作台 | `workbench-home.jsx:65,249-250` | 今日待办、企微接入检查 | 保留；T7.6 隐藏随访相关提示 |

### 6.2 患者 tab（“沟通与随访”分组）

现状（`patients.jsx`）：
- 一级 area tabs L630-634：`病历`、`诊疗辅助`、`沟通与随访`（active 条件 `["messages","followups","tracking","appointments"].includes(tab)`，点击固定 `setTab("messages")`）。
- 二级 section tabs L635-641：记录类 → `RECORD_TABS`（L38）；否则 → `messages`（带 `unprocessedMessages` 计数）、`appointments`、`followups`、`tracking`；插件 tab 以 `p:<pluginId>:<tabId>` 追加（L637-640）。
- 组件分派：`tracking`→`CareTasksPanel` L643；`appointments`→`AppointmentsPanel` L644；`messages`→`WeComPanel` + AI 摘要 + `ChatFollowupsPanel` + 粘贴导入 L674-741；`followups`→`FollowupRecords` + `SurveyPanel` + 提醒计划 + `CampaignPanel` L742-854。
- badges：患者卡片 `dueFollowups`/`unprocessedMessages`/`pendingReminders` L388-398；tab 文案 `unprocessedMessages` L636；消息面板 L691-693；随访提醒入口 L490。

迁移设计：
- `patient.tabs` contribution 增加 `area: "record" | "communication"`，默认 `record`；校验枚举，未知值拒绝。
- 增加 `legacyTab`（可选）：当插件要接管现有 tab 时使用 `legacyTab: "followups"` / `"messages"`，URL 仍为 `?view=patients&patient=...&tab=followups`，不出现 `p:followup:followups`，从而保持所有既有链接、`navigation.js` 白名单和截图不变。
- 增加 `replacesBuiltin: true`（可选）或由 `legacyTab` 隐含：同一 `legacyTab` 只允许一个插件；启用时插件组件替换固定组件，禁用时该 tab 消失（不再回退固定组件，避免“禁用插件仍显示”）。
- `area` 只决定放在哪个一级分组；label/order 由插件提供，T7.5 必须与现状逐字一致：`消息记录`（含 `· N 待整理`）、`复诊预约`、`随访计划`、`检查与转诊`。
- `messages` tab 的固定内容（WeComPanel、ChatFollowupsPanel、AI 摘要、粘贴导入）整体迁入 followup 插件；`tracking` 与 `appointments` 保持固定，仅使用 `area: "communication"` 归组。
- `openRecordTab`（L113-123）、`surveyFocus`（L149-150）、`followupRefresh`（L136-137）、滚动定位（L151-155）由固定 shell 保留，通过 props 传给插件组件，避免 URL/交互变化。

### 6.3 设置面板

- `app-settings.jsx:15-20` 的 `CHANNEL_SECTIONS` 包含 `["followup","患者随访"]`；L218-219 的 else 分支渲染 `ChatConnectionSettings`。
- `settings.panels` 已有 slot；迁移时 followup 插件贡献：
  - `id: "followup"`，`label: "患者随访"`，`order` 与 `CHANNEL_SECTIONS` 一致；
  - `legacyTab: "followup"`，使 URL `?view=settings&settingsTab=followup` 不变；
  - `component: ChatConnectionSettings`。
- `channels`（私聊助手）保留固定 `MessageChannelSettings`；`knowledge-bot`、`notifications` 不动。T7.2 后 `channel-wecom`/`channel-wechat` 的连接配置可在 `followup` 面板内组合，但“消息渠道用途”的 4 项顺序不变。
- `FollowupsView` 的 `onSettings` 依赖 `settingsTab=followup` 落到 `ChatConnectionSettings`；`settings.panels` 的 `legacyTab` 必须保证该跳转仍成立。

### 6.4 Agenda source

`plugins/legacy-agenda/plugin.mjs`：
- `followup` source L39-68：读 `reminders` pending + `follow_ups` paused/due；产出 `id=reminder:<uuid>`、`kind=followup`、`title=随访：...`。
- `messages` source L98-127：读 `care_alerts`、`patient_messages` 未处理、`care_replies` 草稿；产出 `care-alert:<uuid>`、`messages:<uuid>`、`care-draft:<uuid>`。
- `tracking` source 读 `care_tasks` + labs，保持固定。
- T7 迁移：把 `followup` 与 `messages` 两个 source 移到 followup 插件 `agendaSources`；`tracking` 留在 legacy-agenda 或后续 T8。
- 顺序/权重/错误隔离：`doctor-overview` 合并多个 source，单个 source 抛错不得影响其他 kind；插件 source 必须返回同样的 `counts`/`items` 形状。`agenda.json` 快照（all 5、visit 1、followup 1、messages 3）是硬验收。

### 6.5 轮询与 UI 状态

| 组件 | 轮询 | 迁移注意 |
|---|---|---|
| `FollowupRecords` | 15s（`followup-records.jsx:71-83`，`document.hidden` 跳过） | 插件内保留，卸载时清 timer |
| `SurveyPanel` | 15s（`followup-surveys-panel.jsx:137-141`） | 同上 |
| `CareInbox` | 15s（`care-inbox.jsx:68-72`） | 同上 |
| `MessageChannelSettings` | 5s + 二维码 1.5s（`254,260-303`） | 固定区，不迁 |
| `FeishuKnowledgeBotSettings` | 5s（`12-17`） | 固定区，不迁 |
| `DoctorAgenda` | 15s（`doctor-agenda.jsx:85`） | 固定区，不迁 |
| 其它 | `FollowupsView`/`ChatFollowups`/`WechatAutoFollow` 无轮询；`WeComPanel`/`CareContacts` 250ms 搜索 debounce | 插件内保留 |

### 6.6 前端依赖环

- `chat-connection-setup.jsx:2` import `PluginSetup` from `plugin-center`；`plugin-center.jsx` 调 `/api/chat-followups/*`。拆插件前需把 `PluginSetup` 抽到固定 `src/plugin-center.jsx` 的公共组件，或让 `chat-connection-setup` 只依赖 host 的插件中心 slot，禁止反向 import。
- `followups.jsx` 同时 import `CareInbox`(`CampaignPanel`) 与 `ChatFollowupsPanel`；迁移后三者都在 followup 插件内，环消失。
- `patients.jsx` 同时 import followup、care、wecom、chat 组件；T7.5 后只保留 `<Slot name="patient.tabs">` 与固定 `tracking`/`appointments`，不再直接 import 业务组件。

---

## 7. 渠道抽象评估与 `channel.adapters` 接口草案

### 7.1 现状：四套契约

| 契约 | 方法 | 谁实现 | 问题 |
|---|---|---|---|
| `ChatConnectorRegistry` client | `status(config)`、`read(config,cursor,signal)`、`conversations(config,signal)` | `WxCliClient`、`WecomArchiveClient`、`WechatReader`、`WecomAibotChannel` | 只读拉取；`WechatReader` 没有 `conversations`；`status` 语义混杂 |
| `MessageTransport` | `start()`、`stop()`、`send(peer,text,clientId)` | 飞书/微信 iLink | 只管传输，不管绑定/授权；`send` 参数是 peer |
| `CareChannels` | `config/save/kfReady/appReady/public/client/canAutoSend/kfBlocked/choose/send/notify` | 企微客服/客户联系/manual | 只出站；`send` 参数是 `{patientId,text,requestId,targets}` |
| 企微客户联系任务 | `bindings/bind/unbind/draft/submit/refresh/groupDraft/groupSubmit/groupRefresh` | `WeComConnector`/`WecomDirectory` | 私有 API，不被任何抽象包装 |

`WechatExpService` 不是 client，而是 wx-cli 协议的**服务端**（内嵌 9101）；`WeChatMacBridge` 是退役壳。

### 7.2 接口草案

```js
// 逻辑接口，不是最终 TS；实现可在 server/channel/contract.mjs
export const CHANNEL_CAPABILITIES = {
  receive: ["push", "poll", "none"],       // 入站方式
  send: ["direct", "confirm", "manual"],   // 直接发 / 成员确认后发 / 只生成人工任务
  history: false,                          // 是否能读历史消息
  groups: false,                           // 是否支持群
  contacts: false,                         // 是否能枚举联系人
  binding: false,                          // 是否能做患者-联系人绑定
  qr: false,                               // 是否需要扫码
};

export class ChannelAdapter {
  id;                 // "wecom-customer" | "wecom-kf" | "wecom-aibot" | "wechat-desktop" | "wechat-import"
  label;
  capabilities;

  async configure(input) {}        // 保存非秘密配置；secret 走 vault
  async status() {}                // { state, account, lastError, capabilities }
  async connect() {}               // 建立/验证连接；幂等
  async disconnect() {}            // 断开但保留配置
  async send(target, message, opts) {}
  async listConversations(query) {}
  async listContacts(query) {}
  async bind(input) {}
  async unbind(bindingId) {}
  onMessage(handler) {}            // 返回 unsubscribe；push 型必须实现
  async health() {}                // 轻量探活，不产生副作用
  async start() {}                 // 安装轮询/WS
  async stop() {}                  // 清理 timer/socket/子进程
}
```

归一化消息：

```js
{
  channel, adapter, account,
  externalId,              // 稳定去重键；无稳定 ID 时用 sha256(channel+account+text+time)
  direction: "in" | "out",
  kind: "text" | "event" | "system",
  patientId?, bindingId?,
  sender: { externalId, name, relation? },
  conversation: { id, type: "dm" | "group", title? },
  text, time,
  raw?: object,            // 不落敏感原文时省略
}
```

归一化发送结果：

```js
{
  deliveryId?, state: "sent" | "queued" | "awaiting_member" | "unknown" | "failed",
  externalId?, sentAt?, error?, retryable?
}
```

### 7.3 企业微信如何实现

`channel-wecom` 建议包含 4 个 adapter，共享一个插件与一套 `wecom_*` 表：

| adapter | 能力 | 实现映射 |
|---|---|---|
| `wecom-customer` | `receive:none`、`send:confirm`、`contacts:true`、`groups:true`、`binding:true` | `WeComConnector` + `WecomDirectory`；`send` 走 `draft → submit → awaiting_member`，绝不假装已发送 |
| `wecom-kf` | `receive:push`、`send:direct`（48h/5 条窗口内）、`history:true`、`binding:true` | `CareChannels` + `WecomApi` + `care` 的 `kf` 流水线；回调 `/api/wecom/callback` 触发 `syncKf` |
| `wecom-aibot` | `receive:push`、`send:direct`（医生审核后）、`groups:true` | `WecomAibotChannel` + `AibotSocket`；群回复有独立自动发送/限流 |
| `wecom-archive` | `receive:none`、`send:none`、`history:true`、`conversations:true` | `WecomArchiveClient`；只读，不允许发送 |

关键约束：
- `wecom-customer` 的 `send` 返回 `awaiting_member`，不是 `sent`；UI 必须显示“待成员确认”。
- `wecom-kf` 的 48h/5 条窗口判断留在 adapter 内（`CareChannels.kfBlocked`），不能上移到 followup。
- `wecom-aibot` 的 `req_id` 回复/`push` 兜底、8s 超时、30s ping、指数退避留在 socket 层。
- 回调签名/解密留在固定区 `/api/wecom/callback`，通过 `ctx.service("channel-wecom").handleCallback(query, raw)` 调用 adapter；不在插件里新开公开路由。

### 7.4 个人微信如何实现

`channel-wechat` 建议包含 3 个 adapter：

| adapter | 能力 | 实现映射 |
|---|---|---|
| `wechat-desktop` | `receive:poll`、`send:direct`（需可见窗口/头像核验）、`history:false`、`binding:true`、`contacts:true` | `WechatReader` + `WindowsWechatControl`/macOS control；读取受 `visible-delta`、`assertWechatSession` 约束；发送必须双重 OCR/像素核验 |
| `wechat-cli` | `receive:poll`、`send:none`、`history:true`、`conversations:true` | `WxCliClient`（127.0.0.1:9100） |
| `wechat-import` | `receive:none`、`send:none`、`history:true` | `parseWechatExport` / `WechatExpService` 备份产物；导入只生成待复核草稿 |

关键约束：
- 桌面微信不是“打开就能读”：必须先 `status()` 检查平台/权限，`locate()` 绑定会话并校准头像；`send` 必须走 `runSend` 的核验链，失败返回 `unknown`，不得重试盲发。
- 导入/备份解密在外部 exe；应用只解析产物，不存明文密钥。
- wx-cli 是本地 HTTP，必须校验 loopback + 账号/worker_id 一致性；不暴露到非 loopback。
- `wechat-exp` 的 9101 内嵌 bridge 目前 `stopBridge` 从未赋值，T7.2 必须补 `server.close()` 与子进程 kill，否则插件 stop 后端口泄漏。

### 7.5 打包与依赖

- `channel-wecom`：`requires.plugins: []`，`provides: { "channel.adapters": ["wecom-customer","wecom-kf","wecom-aibot","wecom-archive"] }`。
- `channel-wechat`：`requires.plugins: []`，`provides: { "channel.adapters": ["wechat-desktop","wechat-cli","wechat-import"] }`。
- `followup`：`requires.anyOf: [["channel-wecom"], ["channel-wechat"]]`；但两个 channel 插件 `enabledByDefault: true`，即使未配置也视为“已启用”，从而不破坏无渠道的基线。`followup` 的 `available()` 返回 `true`（功能可手动使用），UI 隐藏另由“已连接渠道”状态决定（T7.6）。
- `ctx.service("channel")` 提供 `adapters()` / `get(id)` / `send(adapterId,target,msg)`；`followup` 不直接 import channel 类。
- 服务版本：`apiVersion: 1`；破坏性变更升 2 并拒绝加载旧 followup。

---

## 8. 迁移计划

### 8.1 结构迁移 vs 产品行为变更

| 类别 | 定义 | 允许改动 | 验收 |
|---|---|---|---|
| 结构迁移 | 代码搬家、路由搬家、表所有权声明、UI 组件搬家；**零行为变化** | 文件位置、import、host 能力、插件 manifest | 基线全过、8 截图零 diff、`server/core/**` 无改动 |
| 产品行为变更 | 用户可见的增减/文案/交互 | 仅 T7.6 隐藏入口 | 基线全过；8 截图仍零 diff（若必须变，单独说明并重生成，不得混入结构任务） |

硬约束（每个子任务）：
- `npm run lint`、`npm run build`、`npm test` 退出码 0；T2 起 `npm run test:e2e` 退出码 0。
- `tests/baseline/*.test.mjs` 不改、不弱化；`agenda.json` 快照不改。
- `server/core/**` 不改。
- 不删除表/字段；不 drop legacy 表；不改变既有 API 响应形状。
- 8 张截图零 diff；任何像素变化必须单独任务说明。

### 8.2 目标插件布局

```text
plugins/
  channel-wecom/
    plugin.mjs                 # definePlugin, provides channel.adapters
    migrations/001_init.sql    # wecom_* 表（IF NOT EXISTS）
    adapters/customer.mjs      # WeComConnector + directory
    adapters/kf.mjs            # CareChannels + WecomApi
    adapters/aibot.mjs         # WecomAibotChannel + AibotSocket
    adapters/archive.mjs       # WecomArchiveClient
    api.mjs                    # legacyApiPaths handlers
    tools.mjs                  # wecom_* tools
    prompt.md                  # 企微段落
  channel-wechat/
    plugin.mjs
    migrations/001_init.sql    # 无新表；声明 chat_connections 读取
    adapters/desktop.mjs       # WechatReader
    adapters/wxcli.mjs         # WxCliClient
    adapters/import.mjs        # wechat-export + wechat-exp
    api.mjs
  followup/
    plugin.mjs                 # requires.anyOf, provides followup service
    migrations/001_init.sql    # followup_* / chat_* / care_* 新增表
    core/followups.mjs         # FollowUpManager
    core/surveys.mjs           # FollowUpSurveys
    core/chat.mjs              # ChatFollowups
    core/autofollow.mjs        # WechatAutoFollow
    core/care.mjs              # CareEngine
    api/followup.mjs           # legacyApiPaths
    api/care.mjs
    api/chat.mjs
    tools.mjs                  # followup_create_propose 之外的全部工具
    prompt.md
    agenda.mjs                 # followup/messages sources
    ui/
      index.jsx                # patient.tabs / settings.panels / legacyViews
      FollowupsView.jsx
      FollowupRecords.jsx
      SurveyPanel.jsx
      ChatFollowups.jsx
      CareInbox.jsx
      CareSetup.jsx
      WeComPanel.jsx
      ...
```

`server/core/**` 不动；`plugins/` 可以新增。固定区保留 thin adapter：`server/agent.mjs` 只负责装配/路由委派/生命周期。

### 8.3 宿主能力设计（T7.1）

#### (a) `legacyApiPaths`

插件 manifest：

```js
legacyApiPaths: [
  { method: "GET",  path: "/api/followup-plans" },
  { method: "POST", path: "/api/followup-plans" },
  { method: "*",    path: "/api/patients/:id/followups/:jobId" },
  { method: "*",    path: "/api/patients/:id/followup-surveys/:surveyId/:action" },
]
```

宿主：
- 在 `guard(req, true)` 之后、固定业务路由之前调用 `pluginHost.handleLegacyApi(req, url, { body, send })`；对 `/api/patients/:id/...` 必须在 `parts[1]==="patients"` 大分支（`agent.mjs:2121`）之前调用。
- 路径模式匹配：exact > `:param` > `*`；冲突在 `setup` 时检测并 fail fast（同一 method+pattern 只能一个插件）。
- 只匹配已启用插件；handler 返回 `true` 表示已处理，`false` 继续走固定路由；抛错按现有 500 处理。
- 授权：仍在 guard 之后，不允许插件绕过 token；插件 handler 不接触 `req` 的原始 socket。
- 兼容 `/api/p/<id>/...`：插件可以选择同时暴露新前缀，但 T7 只要求 legacy 路径不变。
- 测试：新增 `tests/plugin-host/legacy-api.test.mjs`（不替换 baseline），覆盖 exact、param、method 不匹配、冲突、disabled、auth。

#### (b) `patient.tabs.area`

贡献：

```js
patientTabs: [{
  id: "followups",
  label: "随访计划",
  order: 30,
  area: "communication",
  legacyTab: "followups",
  replacesBuiltin: true,
  component: FollowupRecords,
}]
```

宿主/前端：
- `src/plugin-slots.jsx` 校验 `area ∈ {"record","communication"}`，默认 `"record"`；`legacyTab` 只允许 `[a-z][a-z0-9-]*`。
- `src/patients.jsx`：
  - 一级 area tabs 不变（病历/诊疗辅助/沟通与随访），但“沟通与随访”的 active 判断扩展到插件 `area==="communication"` 的 tab。
  - 二级 tabs：记录类用固定 `RECORD_TABS` + 插件 `area==="record"`；沟通类用固定 `messages/appointments/followups/tracking` + 插件 `area==="communication"`，按 `order` 合并；`legacyTab` 命中时替换同 id 的固定项，不重复。
  - 插件 tab 的 URL id：有 `legacyTab` 时用 `tab=<legacyTab>`；否则 `tab=p:<plugin>:<id>`。
  - `activePluginTab` 解析同时支持 `tab=` 与 `p:`；`navigation.js` 白名单增加 `legacyTab` 的动态校验（或保持白名单 + 允许 `p:`）。
- T7.5 的验收：4 个标签逐字一致、顺序一致、badge 文案一致、点击/滚动/URL 一致；8 截图零 diff。

#### (c) 后台任务生命周期

`definePlugin` 增加：

```js
lifecycle: {
  async start(ctx) {},   // 安装 timer / 订阅；不阻塞远端连接
  async stop(ctx) {},    // 清 timer / abort / close；幂等
  async drain(ctx) {},   // await 进行中的任务；可超时
}
```

宿主：
- `host.startAll()` / `host.stopAll()` / `host.drainAll()`，按依赖拓扑启动、逆序停止；单插件失败记录并继续，不阻止其他插件。
- `start` 幂等；`stop` 幂等；`drain` 只等待，不再接受新任务。
- `agent.mjs` 的 `server.once("listening")` 调 `host.startAll()`，`server.shutdown` 先 `host.stopAll()` 再 `host.drainAll()`，最后 `store.close()`。
- 现有 `wecomAibot.start` / `wechatExp.start` 在 listen 前启动的行为，迁移后统一到 `startAll`（listen 后），但必须保证 WSS/本地 bridge 在第一个请求前可用；如不能，允许 `prelistenStart` 钩子，但要有测试。
- 测试：启动顺序、停止逆序、异常隔离、重复 start/stop、drain 超时、`server.close` 后无 timer 泄漏（`process._getActiveHandles` 或 fake timer）。

#### (d) 插件依赖与服务调用

`definePlugin` 增加：

```js
requires: { plugins: ["channel-wecom"], anyOf: [["channel-wecom"],["channel-wechat"]] },
provides: { service: "followup", apiVersion: 1 },
```

宿主：
- `ctx.services` 保留固定服务；新增 `ctx.service(id)` / `ctx.plugins[id].service`，只暴露 `provides.service`。
- 依赖解析：`requires.plugins` 必须存在且启用；`anyOf` 至少一个满足；循环依赖 fail fast。
- 启动顺序：被依赖先 start；stop 逆序。
- `followup` 通过 `ctx.service("channel")` 取 adapter 列表，`send` 走统一接口；不得 import `channel-wecom` 文件。
- 服务调用失败：抛结构化错误，followup 记录 `delivery unknown`，不重试盲发。
- 测试：缺依赖、anyOf 满足/不满足、循环、服务版本不匹配、服务抛错隔离。

#### (e) 额外需要但不在四项内的能力

- `legacyViews`：让 `view=followups` / `view=care` 由插件渲染，URL 不变。
- `settings.panels` 的 `legacyTab`：让 `settingsTab=followup` 仍落到同一面板。
- `tools.directory` 的条目可由插件贡献（现有 slot 已支持，只需把固定 catalog 行移出）。
- `agenda.sources` 已有；补齐错误隔离与顺序测试。
- `bootstrap.plugins[].available/connected`：T7.6 隐藏入口需要知道“是否已连接微信/企微”。不要把 `available` 与 `enabled` 混为一谈。

### 8.4 子任务拆分

#### T7.1 宿主能力（无业务迁移）

- **范围**：`server/plugin-host/define.mjs`、`host.mjs`、`src/plugin-slots.jsx`、`src/patients.jsx`（仅 area 合并逻辑）、`src/navigation.js`（`legacyTab` 校验）、`server/agent.mjs`（只改生命周期/路由委派点）。
- **入口**：`PluginHost.handleApi`、`PluginHost.setup`、`server.once("listening")`、`server.shutdown`、`useSlot("patient.tabs")`。
- **交付**：
  - `legacyApiPaths` 匹配/冲突/鉴权测试；
  - `lifecycle.start/stop/drain` 与拓扑顺序；
  - `ctx.service` 与 `provides.service`；
  - `patient.tabs.area/legacyTab/replacesBuiltin` 归一化与合并；
  - `bootstrap.plugins[]` 增加 `available`/`connected`/`capabilities`（不改变现有字段）。
- **验收**：不新增业务插件；基线全过；8 截图零 diff；`server/core/**` 无改动；新增 host 单测通过。

#### T7.2 `channel` 基础 + `channel-wecom` + `channel-wechat`（服务层，无 UI 迁移）

- **范围**：`plugins/channel-*/**`、`server/channel/contract.mjs`（如放固定区需评审）、`server/wecom*.mjs`、`wechat-exp.mjs`、`wechat-bridge.mjs`、`chat-connectors/**`、`messaging/**`、`care/channels.mjs`、`care/wecom-api.mjs`。
- **入口**：`WeComConnector`、`WecomDirectory`、`WecomAibotChannel`、`WechatExpService`、`WechatReader`、`WxCliClient`、`WecomArchiveClient`、`MessageGateway`。
- **交付**：
  - `channel.adapters` 契约 + 归一化消息/发送结果；
  - 4 个 wecom adapter、3 个 wechat adapter，能力矩阵与 7.3/7.4 一致；
  - `legacyApiPaths` 接管 `/api/wecom/*`（callback 除外）、`/api/wechat-exp/*`、`/api/wechat/*`、`/api/message-channels/*`；
  - 表迁移 `wecom_*`；`chat_connections` 只读；
  - 修复 `wechat-exp` 的 `stopBridge`/server close/子进程 kill；
  - `message_*` 归 channel 基础，不归 followup。
- **验收**：服务层 API 响应形状不变；`/api/wecom/callback` 仍公开且签名校验不变；基线全过；8 截图零 diff；无 UI 迁移。

#### T7.3 `followup` 服务层迁移

- **范围**：`plugins/followup/{core,api,migrations,tools,prompt,agenda}.mjs`；从 `agent.mjs` 移除 followup/care/chat/autofollow 的构造与路由，改为 `legacyApiPaths` + `ctx.service`。
- **入口**：`FollowUpManager`、`FollowUpSurveys`、`ChatFollowups`、`WechatAutoFollow`、`CareEngine`、`careApi`、`chatFollowupsApi`、`chatAutoFollowApi`、`chatAibotApi`。
- **交付**：
  - `followup` 插件迁移创建 `followup_*`/`chat_*`/`care_*` 新表，`legacyTables` 声明 `follow_ups`/`followup_plans`/`reminders` 读取；
  - 接管 3.2/3.3/3.4/3.5 的全部私有路由；`/api/reminders` 留固定区，内部调用 `ctx.service("followup").reminderPage`；
  - `pending-actions.mjs` 的 `followup-create` apply 改为服务调用；提案类型/shape 不变；
  - `careTools`/`followups_overview`/`followup_create_propose` 的注册迁到插件 `tools`，固定区只保留 `pending.propose` 与安全限制；
  - `agendaSources` 接管 `followup`/`messages`；
  - `followups.start/stop/drain`、`chatFollowups.start/stop`、`care.start/stop/drain` 全部走插件 lifecycle。
- **验收**：`followup.test.mjs` 全过且不改；`agenda.json` 快照全过；`POST /api/agent/run` 的 `tool.complete` 仍为 `followup_create_propose`；8 截图零 diff。

#### T7.4 `followup` 前端迁移（页面/患者 tab/设置）

- **范围**：`plugins/followup/ui/**`；`src/followups.jsx`、`followup-records.jsx`、`followup-surveys-panel.jsx`、`chat-followups.jsx`、`chat-autofollow.jsx`、`care-inbox.jsx`、`care-setup.jsx`、`care-contacts.jsx`、`wecom-panel.jsx`、`wechat-import.jsx`、`questionnaire-editor.jsx`、`chat-connection-setup.jsx`。
- **入口**：`patient.tabs`（`messages`/`followups`，area communication，legacyTab 同名）、`settings.panels`（followup，legacyTab followup）、`legacyViews`（followups/care）、`tools.directory`。
- **交付**：
  - 组件搬家，props/URL/轮询/草稿/滚动/focus 保持；
  - 解除 `chat-connection-setup` ↔ `plugin-center` 环；
  - `patients.jsx` 只保留 shell + `tracking`/`appointments` 固定组件；
  - `app-settings.jsx` 只保留固定 `channels/knowledge-bot/notifications`，followup 由 slot 渲染；
  - `work-directory.jsx` 移除固定 `care/followups` 行，改 slot。
- **验收**：4 个患者 tab 文案/顺序/badge 零变化；`FollowupsView`/`CareInbox` 路由和跳转零变化；8 截图零 diff；所有轮询在卸载后清理。

#### T7.5 收口：删除固定区重复装配

- **范围**：`server/agent.mjs` 删除已迁的 imports/constructors/routes/start-stop；`server/store.mjs` 只保留 legacy 建表；`docs/refactor/PLUGIN_REFACTOR_PLAN.md` 更新 T7 状态。
- **交付**：固定区只剩 `pluginHost` 委派；无重复服务实例；无重复路由；`server/core/**` 无改动。
- **验收**：全量基线 + e2e + 8 截图；`rg "new FollowUpManager|new ChatFollowups|new CareEngine" server/agent.mjs` 为空；插件禁用后服务不启动。

#### T7.6 产品变更：无渠道时隐藏随访入口（最后做）

- **前置**：T7.1–T7.5 全部验收；渠道连接状态可从 `bootstrap.plugins[].connected` 或 `/api/chat-followups/settings` 读取。
- **判定**：`connectedFollowupChannel = channels.some(c => (c.channel==="wecom"||c.channel==="wechat"||c.channel==="wecom-aibot") && c.enabled && c.status.state==="ready")`。只有“已启用且已连接”才算；仅安装插件/有配置不算。
- **隐藏入口**（无渠道时）：
  1. `work-directory.jsx` 的“随访”卡片；
  2. `command-palette` 的随访命令（当前只有 care；若新增则隐藏）；
  3. `app-settings` 的“消息渠道 → 患者随访”子项；
  4. `FollowupsView` 的入口（`view=followups` 直达时显示空态/引导连接，不显示业务 tab）；
  5. 患者“沟通与随访”中的“随访计划”tab；`messages` tab 保留（可手动粘贴/导入，不依赖渠道）；
  6. 患者卡片 `dueFollowups` 徽标与排序项“随访到期优先”（无渠道时不再显示随访到期）；
  7. 工作台“随访/企微接入”检查项；
  8. `ChatConnectionSettings` 中的“自动随访/聊天随访”区块（保留“连接渠道”引导）。
- **不隐藏**：`agenda` 的既有 `followup` item、`/api/reminders`、`/api/followups*`、`followup_create_propose`、demo pack 的示例随访。原因：基线 `followup.test.mjs` 在无渠道时创建随访，`agenda.json` 期望 `followup=1`；隐藏入口不能删除既有数据/能力。若要“彻底隐藏”，必须另立任务并接受基线/截图更新，不能混入 T7.6。
- **示例数据**：`DemoPack` 仍创建“示例·血糖控制季度随访”、care 草稿/告警（`demo-pack.mjs:121-129,155-159`）。T7.6 不修改 demo pack；UI 隐藏后这些数据仍可通过 agenda/API 访问，避免破坏截图与基线。可在后续“示例体验”任务中把随访示例改成“连接渠道后可见”，但不属于 T7。
- **空态文案**：`view=followups` 直达时显示“连接微信/企业微信后启用随访”，提供跳转 `settingsTab=followup`；不显示“新建随访”按钮。
- **验收**：基线全过；8 截图零 diff（因为 8 张截图不包含被隐藏的随访入口，agenda 的既有 item 保留）；新增 UI 测试覆盖“无渠道隐藏/有渠道显示”；不修改 API/表/Agent 工具。

### 8.5 子任务依赖图

```text
T7.1 宿主能力
  ├─ T7.2 channel-wecom / channel-wechat（服务层）
  │     └─ T7.3 followup 服务层
  │           └─ T7.4 followup 前端
  │                 └─ T7.5 收口
  │                       └─ T7.6 产品隐藏
  └─ （T7.2 可与 T7.1 的测试并行，但合并顺序必须先 T7.1）
```

### 8.6 验收矩阵

| 子任务 | lint | build | test | e2e | 8 截图 | server/core | baseline 路由/快照 |
|---|---|---|---|---|---|---|---|
| T7.1 | ✅ | ✅ | ✅ | ✅ | 零 diff | 无改动 | 全过 |
| T7.2 | ✅ | ✅ | ✅ | ✅ | 零 diff | 无改动 | 全过；callback 签名测试 |
| T7.3 | ✅ | ✅ | ✅ | ✅ | 零 diff | 无改动 | `followup.test` 原样；agenda 快照 |
| T7.4 | ✅ | ✅ | ✅ | ✅ | 零 diff | 无改动 | 全过；tab/URL 测试 |
| T7.5 | ✅ | ✅ | ✅ | ✅ | 零 diff | 无改动 | 全过；无重复实例 |
| T7.6 | ✅ | ✅ | ✅ | ✅ | 零 diff | 无改动 | 全过；新增隐藏/显示测试 |

---

## 9. 风险清单

| # | 风险 | 影响 | 证据 | 缓解 |
|---|---|---|---|---|
| 1 | `follow_ups` 重启恢复把 `running` 改 `paused`，不重放 | 中断后随访不自动继续，医生需手动恢复 | `followups.mjs:30-43` | 保持现状；UI 明确“已中断，请核对后恢复”；不要用自动重试掩盖 |
| 2 | 随访执行无 lease/claim CAS，只靠 `status='running'` + `inFlight` | 多进程/重复 tick 可能重复执行 | `followups.mjs:483-503` | 单实例 SQLite；host 生命周期保证只 start 一次；未来加 `lease_until` |
| 3 | `ChatFollowups.send` 是“屏幕核验发送”，结果可能是 `unknown` | 重复发送/漏发 | `chat-followups.mjs:368-390`；`wechat-reader.mjs:279-379` | 发送前 `requestId`/revision；失败置 `unknown`，人工核对；禁止自动重试 |
| 4 | `chat_outreach.send` 无幂等键，重复调用会重复发 | 患者收到重复消息 | `chat-autofollow.mjs:96-109` | 插件层加 `requestId`；发送前检查 `status`/`sentAt`；保留人工确认 |
| 5 | `care_replies` 发送 CAS `sending`，崩溃后恢复 `unknown` | 状态不确定 | `care/engine.mjs:77-82,370-407` | 保持 `unknown`，不自动重发；UI 提示核对 |
| 6 | `wecom_tasks` 提交 `submitting` 崩溃恢复 `unknown` | 企微任务状态不确定 | `wecom.mjs:47-51,173-190` | 不自动重发；`refresh` 回查；UI 显示“待确认” |
| 7 | `wechat-exp` 的 9101 server 从不 close，`stopBridge` 未赋值 | 端口泄漏，重启/换配置失败 | `wechat-exp.mjs:106,248` | T7.2 补 `stopBridge = () => server.close()`、子进程 kill、`stop()` await |
| 8 | 凭据键分散、掩码策略不一致 | 泄露/迁移遗漏 | `wecom:corp:v1`、`care:channels:v1`、`message-channel:*`、`chat:*` | 统一 vault 键命名；公开状态只给布尔/非秘密 id；迁移测试覆盖 |
| 9 | `MessageTransport` 微信 cursor 最后推进、失败退避 | 重启重复/漏消息 | `transports.mjs:198-260` | 保持 cursor 事务；插件 stop 等待 poll 退出；测试断线重连 |
| 10 | `AibotSocket` 认证失败不重连、指数退避 1s→30s | 配置错误时静默 | `wecom-aibot-ws.mjs:87-91,135-150` | 状态暴露 `lastError`；10s reconcile 在 secret/revision 变化时重试 |
| 11 | 插件 API 只支持 `/api/p/`，legacy 路由冲突 | 404/覆盖固定路由 | `host.mjs` handleApi；`agent.mjs:1131` | T7.1 实现 exact/param 匹配 + 冲突 fail fast；先于固定 patient 路由 |
| 12 | `patient.tabs` 只有 id/label/order，无 area/legacyTab | 插件 tab 进不了“沟通与随访”或 URL 变化 | `plugin-slots.jsx`；`patients.jsx:630-641` | T7.1 增加 area/legacyTab/replacesBuiltin；契约测试 |
| 13 | 插件生命周期不存在 | 定时器/WS 泄漏或重复启动 | `define.mjs` 无 start/stop；`agent.mjs:2701-2754` | T7.1 lifecycle + 拓扑顺序 + drain 超时 |
| 14 | `ctx.services` 无插件间服务 | followup 只能 import channel，破坏插件边界 | `host.mjs` contextFor | T7.1 `provides.service`/`ctx.service`；版本校验 |
| 15 | agenda source 插件抛错影响整体 | 今日待办空白 | `doctor-overview` 合并；`legacy-agenda` | 单 source try/catch + 错误计数；插件 source 测试 |
| 16 | 前端 6 处轮询在插件卸载后未清 | 内存/请求泄漏 | `followup-records:71`、`surveys:137`、`care-inbox:68` 等 | useEffect cleanup + 插件卸载测试 |
| 17 | `chat-connection-setup` ↔ `plugin-center` 循环 import | 构建/加载顺序问题 | `chat-connection-setup.jsx:2`；`plugin-center.jsx` | 先抽公共 `PluginSetup` 到固定组件或 slot |
| 18 | 截图零 diff 与 T7.6 隐藏冲突 | 验收争议 | 8 截图含 agenda（有 followup item）、不含随访入口 | T7.6 只隐藏入口、保留既有 agenda item；如产品要求彻底隐藏，单独任务重生成截图 |
| 19 | `reminders` 被误迁 | 风险/提醒/agenda 全断 | `store.mjs:90` 多读者 | 固定区共享；followup 只写 `kind='followup'` |
| 20 | `patient_messages` 被渠道直接写 | 去重/processed 状态破坏 | `patients.ingest` 唯一写入口 | channel 只调 `patients.ingest`；代码评审禁止直接 INSERT |

---

## 附录 A：基线不可变清单

| 测试 | 路径 | 断言 |
|---|---|---|
| `followup.test.mjs` | `POST /api/agent/run` | 200、completed |
| 同上 | `GET /api/sessions/:id` | `tool.complete.payload.tool === "followup_create_propose"` |
| 同上 | `GET /api/pending-actions?type=followup-create&patientId=` | 存在 pending |
| 同上 | `POST /api/pending-actions/:id/confirm` | `ok`、`applied.name`、`applied.patientId` |
| 同上 | `GET /api/doctor/overview?limit=100` | `kind=followup`、`id` 前缀 `reminder:`、title `随访：` |
| 同上 | `GET /api/reminders?patientId=&status=pending` | 存在同名 reminder |
| `agenda.test.mjs` | `GET /api/doctor/overview?limit=100` | 快照 counts/items 完全一致 |

## 附录 B：关键文件行数

- 随访核心：985 + 699 + 658 + 38 + 168 + 11 + 590 = **3,149**
- 渠道/care：245 + 373 + 264 + 11 + 128 + 14 + 63 + 380 + 212 + 162 + 52 + 285 + 906 + 316 + 272 + 55 + 173 + 982 + 49 + 104 + 136 + 100 + 98 = **5,380**
- 前端：585 + 681 + 266 + 237 + 71 + 186 + 342 + 139 + 149 + 78 + 14 + 418 + 161 + 151 + 155 + 58 = **3,691**

## 附录 C：待确认问题（实施前需产品/架构拍板）

1. T7.6 的“隐藏”是否接受“只隐藏入口、保留既有 agenda item/API/示例数据”？本文按“接受”设计，以保基线；若要求彻底隐藏，需要单独的产品变更与截图重生成。
2. `channel` 基础（`message_*`）是做成独立 `channel` 插件，还是留在 `server/plugin-host` 作为 host 服务？本文建议独立基础插件，避免 followup 拥有通用消息表。
3. `care` 是否整体归 `followup`，还是拆成 `care` 子插件？本文按用户给定的三插件范围，把 care 作为 followup 子模块。
4. `wecom-customer` 的“待成员确认”是否允许 T7 后仍不自动发送？本文按现状保留（`send:confirm`），不把“自动发送”作为迁移目标。
5. 8 张截图是否包含随访入口的像素。如果 T7.6 隐藏后出现 diff，必须先确认是“预期产品变更”还是“截图选择遗漏”，不能直接更新基线。

## 附录 D：验收者决定（2026-10-29）

1. **T7.6 隐藏范围**：接受"只隐藏入口"。没有已连接的微信/企微渠道时，隐藏新建/管理随访的入口；既有的 agenda 条目、API、Agent 工具和示例数据保留。产品负责人如果之后要求彻底隐藏，另开任务。
2. **通用消息表 `message_*`**：做成独立的基础插件 `channel`。它定义 `channel.adapters` 契约并拥有网关；`channel-wecom` 和 `channel-wechat` 依赖它。不放进 plugin-host（宿主保持与业务无关）。飞书机器人以后作为 `channel-feishu` 适配器接入。
3. **care**：作为 `followup` 的子模块（`plugins/followup/core/care.mjs`），不单独拆插件。
4. **企微客户联系发送**：保持现状，需要成员确认（`send:confirm`）。迁移不改变任何"发给患者"的确认语义：发送前必须有医生确认。
5. **截图**：结构迁移任务（T7.1–T7.5）中出现任何像素差异都按失败处理，不能更新基线；只有 T7.6 可以在说明原因后由验收者重新生成截图。
