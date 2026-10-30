# 医疗工作台：沙箱、子代理与持久调度

实现日期：2026-09-07。三者是独立机制，通过会话引擎的资料快照、取消信号和事件日志组合使用。

> 2026-10-30 更新：旧 `MedicalRuntime` 已移除，所有会话由统一内核执行。旧的 `server/subagents.mjs`、`delegate_medical_task` 和模型工具 `sandbox_python` 随旧引擎下线，下文已按统一内核更新；手动隔离计算（`sandboxCode`）与持久调度仍可用，计划任务不再单独指定子代理。

## 设计依据

- [DeepSeek Harness Process Sandbox](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/subsystems/sandbox.md)：平台执行器负责真正的文件访问隔离；不能静默回退到不受限制的进程。
- [Codex Sandbox](https://learn.chatgpt.com/docs/sandboxing)、[Codex 子代理](https://learn.chatgpt.com/docs/agent-configuration/subagents)：子代理继承父任务的权限边界，隔离执行权限与模型建议分离。
- [Hermes 子代理](https://hermes-agent.nousresearch.com/docs/user-guide/features/delegation/)、[Hermes Cron](https://hermes-agent.nousresearch.com/docs/user-guide/features/cron/)：父任务内的委派和能独立存活的定时工作应有不同生命周期。

本项目自研实现这些适合资料工作的机制，没有引入上游全部 Runtime，也不宣称协议兼容。

## 沙箱

`server/sandbox.mjs` 在本机 macOS Seatbelt 下启动 Python。默认拒绝：不允许联网，不允许读用户目录或数据库，不允许创建子进程，不允许写文件（仅放行 `/dev/null`）。只放行 Python 和系统运行库、根目录本身的读取。资料以 stdin JSON 传入，环境变量不继承模型密钥。Python 使用 `-I -S -B`，不加载用户 site-packages 或启动脚本。

代码可使用 Python 标准库和 `sources`（本轮所选材料及任务输入原文），将 JSON 兼容值赋给 `result`。每次执行采用临时空工作目录，结束后清理；stdout/stderr 合计最多 64KiB，墙钟 5 秒，CPU 硬限制 3 秒，最多 2 个并发任务。取消和超限终止进程组。内存为每 100ms 采样的 256MiB RSS watchdog，**不是硬内存配额**，不能当作抵抗恶意内存瞬时分配的容器级资源隔离。

入口为界面的“计划任务与沙箱 → 隔离计算”（模型工具 `sandbox_python` 已随旧引擎下线；模型侧计算用 `calculate_python`）。代码、资料版本和运行状态写入事件轨迹，结果留在会话中且明确待复核。不会自动批准产物或修改原始记录。沙箱计算结果只有 JSON 和会话文本，当前不提供生成文件的下载通道。

科研分析使用另一套独立的科研计算沙箱（同样基于 Seatbelt，带 pandas/statsmodels 等科学计算库，限额更宽），见 [RESEARCH](RESEARCH.md)。

当前已在本机 macOS 实测。Linux/Windows/Docker 尚未实现；Python 或 Seatbelt 探测失败时工具不暴露，手动执行返回 `SANDBOX_UNAVAILABLE`，不会无沙箱降级。`MEDICAL_SANDBOX_PYTHON` 可指定本机可信 Python；默认探测 Homebrew / 系统 Python。服务端显式注册的 JavaScript `toolPlugins` 仍是可信同进程扩展，不受 Python 沙箱保护，不接受模型上传插件。

## 子代理

统一内核提供两种委派：

- `delegate_task` / `delegate_tasks`（医疗会话推荐）：父任务并行委派 1–3 个只读子任务，整次父任务合计最多 3 个。子任务继承父任务本轮的材料（`context.sources`）和领域上下文（关联患者、材料索引、医生偏好），可用医疗只读工具（如 `read_source`、`search_materials`、`read_patient_brief`）；不能写文件、写计划、递归委派、调用 MCP/浏览器，也不能确认提案（`*_confirm`）。单个子任务最多 6 轮、上下文 60000 字符，受父任务时限约束。
- `spawn_agent`（编程工作区）：异步 reader / writer / verifier 团队，面向代码和文件修改，工具限于文件、git、终端和文档类，不含医疗工具。

子任务结果记录在运行的 `children` 中，用量累加到父任务。父任务取消会传递到子任务；任一子任务失败不会被伪装成成功。

## 调度

`server/scheduler.mjs` 使用同一 SQLite 的 `scheduled_jobs` 表，关闭浏览器不影响计划，关闭本地 Node 服务则不会执行。当前支持单次和 1 分钟至 1 年的固定分钟间隔。界面时间按浏览器本机时区输入，存储为 UTC 时间戳；每 24 小时是固定时长，不是带夏令时语义的日历 cron。尚无任意 cron 表达式、依赖 DAG、系统唤醒或 OS 守护进程安装。

计划创建时绑定会话、固定任务和所选资料 ID/哈希。模型计划需单独明确授权重复外发，并绑定当前 provider/base URL/model；执行前检查材料和模型身份，变化后暂停。新增资料不自动加入。每次计划以全新模型上下文运行，不带入既往会话及其派生信息。没有网络消息投递功能，所有结果仅写回本地会话。

同会话不重叠执行，遵守全局运行上限。领取任务在单数据库 owner 内同步完成，用 `schedule_<id>_<due>` 做请求幂等。错过多个周期只补一次，按原计划节奏计算下个未来时点；失败或取消后暂停，单次成功后 completed。运行中重启的计划暂停并记录 interrupted，避免不确定的外部调用被自动重放。保留最近 50 条计划摘要；完整运行轨迹仍在 session event log 中。创建、暂停、恢复、删除均有本地审计。

API（均需 X-Medical-Token）：

| 请求                                      | 用途                                                                                                   |
| ----------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| GET /api/sessions/:id/schedules           | 列出计划与最近执行摘要                                                                                 |
| POST /api/sessions/:id/schedules          | 创建，字段 name/message/runAt/intervalMinutes/fileIds/mode/externalConsent/sessionRevision |
| PATCH /api/sessions/:id/schedules/:jobId  | 按 revision 更新 status 为 active 或 paused                                                            |
| DELETE /api/sessions/:id/schedules/:jobId | 按 revision 删除非运行中的计划                                                                         |
| POST /api/chat/:id/cancel                 | 取消当前运行，包括计划发起的运行                                                                       |

这些机制服务于医疗资料整理。它们没有使系统成为能自主下医嘱、调整药量或作出临床判断的系统。
