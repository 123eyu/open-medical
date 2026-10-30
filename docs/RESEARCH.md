# 科研能力：数据层、计算层与方法学技能

实现日期：2026-10-30（第一阶段）。

目标：框架只提供通用能力，由 agent 结合方法学技能自己规划研究。框架不为每种研究写死流程。「某类患者有什么共性」「哪些因素与结局相关」「从文献找方向再用本地数据验证」都用同一套能力完成。

## 分层

| 层 | 作用 | 状态 |
|---|---|---|
| 数据层 | 患者库 → 脱敏长表 + 数据字典 | ✅ `server/medical/research-dataset.mjs` |
| 计算层 | 科研 Python 沙箱（pandas/scipy/statsmodels/lifelines/sklearn/matplotlib） | ✅ `server/core/research-python.mjs` |
| 工具面 | `research_data_dictionary`、`research_analyze` | ✅ `server/medical/research-tools.mjs` |
| 方法学 | 技能 `cohort-factor-analysis`、`research-direction-scouting` | ✅ `skills/` |
| 研究项目对象 | 方案、分析计划锁定、步骤记录、跨会话续做、医生确认节点 | 待做（第二阶段） |
| 文献选题编排 | 更大的子代理预算，并行精读文献 | 待做（第三阶段，当前用 `delegate_tasks` 加技能） |

## 数据层

`buildResearchDataset(patients)` 把患者库整理为五张长表：`patients / diagnoses / medications / labs / visits`。脱敏在这一层强制完成：

- 患者编号换成稳定假名 `pid`（`R` + 10 位十六进制，同一患者每次一致）；
- 去掉姓名、电话、病历号、来源文件名和自由备注；
- 出生年份换成当前年龄，≥90 岁统一记为 90；
- 绝对日期换成 `year`（年份）和 `day`（距该患者首条带日期临床记录的天数），保留先后顺序和间隔；
- 诊断名、就诊事由、药名再过一遍身份和长编号打码（复用 `deidentify.mjs`）。

数据快照带内容哈希，同一份数据哈希不变，可据此判断结果能否复现。

`researchDataDictionary()` 只输出汇总信息：各表覆盖人数、常见诊断/用药/检验（单位、取值范围、年份）、同一指标的不同写法、分组/标签分布。agent 先看字典判断研究是否可行、确定变量口径，然后写分析代码。

## 计算层

- 独立虚拟环境：`<数据目录>/research-python/venv`（Windows 优先用 `py -3.12` 创建），只在用户于「设置 → 科研计算环境」点击后安装（`GET /api/research-env`、`POST /api/research-env/install`），按清华 → 阿里 → 官方 pypi 的顺序尝试镜像。`MEDICAL_RESEARCH_PYTHON` 可以指定一个已装好这些包的可信解释器。
- **macOS**：Seatbelt 默认拒绝。禁网、禁子进程，只能读 Python 运行库和系统字体，只能写本次运行的临时目录（用来存图）。
- **Windows**：使用 AppContainer 加 Job 对象（`server/core/assets/appcontainer-run.ps1`，通过 PowerShell 内嵌 C# 调用 Win32 API）。不授予任何能力，因此没有网络，也访问不了本机回环地址；只能访问显式授权给容器 SID 的目录（Python 安装目录、venv 和本次运行的工作目录，首次运行时用 icacls 授予只读权限）。Job 对象限制只能有一个活动进程（不能创建子进程），设置硬内存上限，启动器退出时一并结束子进程。由于 venv 里的 `python.exe` 是会再拉起子进程的转发器，Windows 上直接用基础解释器启动，再把 venv 的 site-packages 加进路径。
- 其他平台失败关闭，不会无沙箱降级。
- 真实隔离测试：`tests/core/research-sandbox.test.mjs`（需设置 `MEDICAL_RESEARCH_PYTHON`）；CI 工作流 `.github/workflows/research-sandbox.yml` 在 macOS 和 Windows 上各跑一次。
- 限额：墙钟 120 秒；内存 2GB（macOS 为采样监测，Windows 为 Job 对象硬限制）；输入 50MB；同时只跑一项分析。
- 数据通过 stdin 传入，在沙箱内转成 `tables[...]` DataFrame。代码把汇总结果赋给 `result`；`print` 的内容截取末尾 8KB 作为 log 返回；`plt` 画的图保存为会话成果。

## 防错与可复现（框架强制，不只靠提示词）

- **逐行数据不出沙箱**：结果和 log 中出现超过 20 个不同的患者假名编号，整次分析直接拒绝（`RESEARCH_ROW_LEVEL`）。
- **出处**：每次分析返回数据快照哈希、代码哈希、Python 和统计包版本；完整代码记录在运行轨迹里。
- **多重比较披露**：每次分析返回本会话的分析序号，技能要求在报告里写明一共做了几项分析。
- **先定计划再看结局**：目前由技能要求、医生在对话里确认。第二阶段会把分析计划做成锁定对象（记录哈希，事后改动会被标出），并用待确认流程作为关卡。
- 所有结果标记为 `draft`，属探索性、相关性结论，不改患者档案。

## 已知限制

- 只能分析结构化字段（诊断、用药、检验、就诊、治疗方案）。病历原文里的信息需要先整理进档案才能参与分析。
- 用药没有起止日期，无法做严格的暴露时间窗分析。
- 分析序号只保存在进程内存里，服务重启后从 1 重新计数（第二阶段改为持久化的研究项目记录）。
- 防泄露检查只针对假名编号。把逐人数值大段输出仍然可能绕过检查；技能和工具说明都要求只返回汇总结果。
