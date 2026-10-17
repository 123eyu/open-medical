<div align="center">

<img src="public/favicon.svg" width="76" height="76" alt="Open Medical 标识" />

# Open Medical

### 让患者资料、医学知识和你的经验，接上每一次诊疗。

开源的本地医学 AI 工作台 · 患者管理 · 知识积累 · 持续随访

[![License: MIT](https://img.shields.io/badge/License-MIT-28735b?style=flat-square)](LICENSE)
[![Desktop](https://img.shields.io/badge/Desktop-macOS%20%7C%20Windows-334155?style=flat-square)](docs/DESKTOP.md)
[![Node.js](https://img.shields.io/badge/Node.js-%E2%89%A5%2022.18-28735b?style=flat-square)](package.json)

**中文** · [English](README_EN.md)

[观看演示](#产品演示) · [快速开始](#快速开始) · [使用指南](docs/DOCTOR_WORKBENCH_GUIDE.md) · [文档导航](#文档导航)

</div>

---

Open Medical 是面向医生的本地患者管理智能助手。把分散的病历、检验、随访记录整理到同一位患者下，把常用指南、模板和案例留在自己的知识库里；需要时，通过对话查找、整理和继续跟进。

**资料在本机积累，模型按需连接，结果由医生复核。** 支持本地 Ollama / vLLM，以及 DeepSeek、OpenAI、Anthropic、OpenRouter 和 OpenAI 兼容服务。

## 产品演示

[![Open Medical 产品演示：患者档案、随访与个人知识库](docs/assets/open-medical-preview.gif)](https://github.com/JuneYaooo/open-medical-workbench/blob/main/docs/assets/open-medical-tour.mp4)

<p align="center">
  <a href="https://github.com/JuneYaooo/open-medical-workbench/blob/main/docs/assets/open-medical-tour.mp4"><strong>▶ 观看完整演示 · 79 秒 · 中文配音与字幕</strong></a>
  <br />
  <sub>点击上方预览打开视频。演示使用示例资料，部分界面随版本迭代有所调整。</sub>
</p>

## 一个工作台，接住日常工作

| | 你可以做什么 |
| :--- | :--- |
| **患者档案** | 新建患者或导入名单，汇总诊断、用药、过敏信息和检验趋势；接诊前快速回顾患者状态。 |
| **对话式整理** | 添加病历和报告，让助手整理时间线、提取信息、准备文书；对照来源核对档案变更提案。 |
| **随访与跟进** | 从今日待办处理到期随访、检查和转诊，登记实际联系结果，继续安排下一次。 |
| **个人知识库** | 按用途组织指南、模板和笔记，检索原文与出处，通过知识图谱浏览资料关系。 |
| **案例与记忆** | 收录有价值的病例、查找相似案例，保存确认过的工作偏好，为后续任务提供上下文。 |
| **消息与提醒** | 归档患者消息，连接医生微信或飞书提醒；授权飞书机器人查询可分享的知识库。 |

### 从一份材料，到下一次随访

1. **带入资料** — 选择患者，添加门诊记录、检查报告或已有材料。
2. **整理与核对** — 在对话中提取事实、查阅知识，核对来源与待写入的档案内容。
3. **保存与跟进** — 保存记录，安排随访或检查转诊，处理今日待办。
4. **积累与复用** — 将常用资料、案例和已确认偏好用于后续任务。

知识与偏好的积累用于检索和上下文复用，不会自动训练模型。完整流程见 [医生使用指南](docs/DOCTOR_WORKBENCH_GUIDE.md)。

## 快速开始

需要 **Node.js ≥ 22.18** 和 npm。先在本机运行，再按需配置模型。

```bash
git clone https://github.com/JuneYaooo/open-medical-workbench.git
cd open-medical-workbench
npm ci
npm run build
npm start
```

打开 [http://127.0.0.1:8787](http://127.0.0.1:8787)。页面与 API 由同一个本地进程提供，默认仅监听本机。

**首次使用：** 新建患者 → 添加资料 → 在设置中连接模型 → 发起整理任务。无需配置模型，也能管理患者档案、登记临床资料和随访记录。

### 桌面版

在对应系统中构建便携桌面包：

```bash
npm run package:mac    # macOS
npm run package:win    # Windows：在 Windows 上构建
```

输出位于 `release/`。macOS 打开 `.app`，Windows 从完整便携目录运行 `Open Medical.exe`。桌面版有独立数据目录；关闭窗口后可继续在后台运行，退出应用会停止运行。安装、平台验证与签名限制见 [桌面版说明](docs/DESKTOP.md)。

### 连接模型

在 **设置 → 模型连接** 中选择服务并填写模型信息，也可复制 `.env.example` 为 `.env`，配置 `AI_PROVIDER` 与对应密钥后重启。

| 方式 | 适用场景 |
| :--- | :--- |
| 本地 Ollama / vLLM | 使用自己部署的模型；模型与依赖就绪后可离线运行。 |
| DeepSeek / OpenAI / Anthropic / OpenRouter | 使用自己的 API 密钥连接外部服务，费用由对应服务商收取。 |
| OpenAI 兼容接口 | 连接自建或第三方兼容端点，自行填写地址和模型 ID。 |

上下文窗口与最大输出可在模型连接中调整。外部模型会接收获授权的材料原文及相关上下文；选择本地存储并不意味着云模型请求不会外发。

## 本地数据与使用边界

- **本地保存。** 患者、消息、随访和会话保存在本机 SQLite。模型连接密钥通过本地凭据保险库加密保存，**患者数据库本身未加密**。
- **按授权执行。** 模型外发遵循界面中的授权范围；计划任务与随访自动总结需单独授权。文件修改可查看提案与差异，授权方式由工作区设置决定。
- **医生复核。** AI 结果用于辅助整理和准备，临床有效性尚未验证，不能替代医生判断。内置用药与检验规则覆盖有限，不提供完整药物安全保证。
- **单医生使用。** 多人权限、机构级审计、HIS / EMR / FHIR 对接和机构部署验收尚未实现。

<details>
<summary><strong>数据位置、备份与恢复</strong></summary>

源码运行的数据默认位于 `server/data/medical.sqlite`，可用 `MEDICAL_DATABASE` 指定路径。桌面版使用独立的系统应用数据目录，详见 [桌面版说明](docs/DESKTOP.md)。

```bash
npm run backup
```

恢复前停止服务，将 `MEDICAL_DATABASE` 指向备份副本再启动。备份同样包含医疗资料，应按原库标准保管。删除患者会同时删除其工作区及相关记录，不会删除已经导出的文件或备份。

</details>

## 可扩展的 Agent 底座

医疗工作台建立在通用 Agent 运行时上：模型与工具循环、文件工作区、历史分支、计划任务、上下文管理和后台执行共用同一套底座。可按需接入 Skills、MCP、插件，以及浏览器、终端和办公文件工具。

通用模式可独立运行，不加载医疗运行时或患者表：

```bash
npm run build
npm run platform        # http://127.0.0.1:8788
```

开发前端使用 `npm run dev`；独立工作区 CLI 使用 `npm run workspace --`。Docker 为可选依赖，用于容器化终端与部分办公工具。具体支持范围见 [验证说明](docs/VALIDATION.md) 与 [运行时兼容说明](RUNTIME_COMPATIBILITY.md)。

## 文档导航

| 想了解什么 | 从这里开始 |
| :--- | :--- |
| 医生首次使用与完整流程 | [医生使用指南](docs/DOCTOR_WORKBENCH_GUIDE.md) |
| 桌面安装、构建与数据目录 | [桌面版说明](docs/DESKTOP.md) |
| 医生提醒与飞书知识库机器人 | [连接指南](docs/doctor-assistant-channels.md) |
| 微信、企业微信与消息归档 | [聊天连接插件](docs/chat-connectors.md) |
| 患者、消息和随访的数据关系 | [患者管理](docs/PATIENTS.md) |
| 系统架构与扩展开发 | [架构说明](docs/ARCHITECTURE.md) · [通用内核](docs/GENERIC_RUNTIME.md) · [编排与调度](docs/ORCHESTRATION.md) |
| 支持范围与验证情况 | [验证说明](docs/VALIDATION.md) · [运行时兼容说明](RUNTIME_COMPATIBILITY.md) |
| 私有远程任务队列与 Worker | [远程部署](deploy/remote/README.md) |

## 参与贡献

欢迎通过 [Issues](https://github.com/JuneYaooo/open-medical-workbench/issues) 反馈问题或提出建议，通过 Pull Request 改进代码和文档。反馈时请附复现步骤、系统与版本信息，并移除患者资料和密钥。

代码修改可在本地运行检查；真实模型验证需要自行配置模型：

```bash
npm run check           # lint、测试与生产构建
npm run verify:model    # 真实模型流式输出、工具调用与续轮
```

## 许可证

[MIT](LICENSE)
