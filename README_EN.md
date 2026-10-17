<div align="center">

<img src="public/favicon.svg" width="76" height="76" alt="Open Medical logo" />

# Open Medical

### Bring patient records, medical knowledge and experience into every visit.

An open-source, local AI workbench for doctors · Patient records · Knowledge · Follow-up

[![License: MIT](https://img.shields.io/badge/License-MIT-28735b?style=flat-square)](LICENSE)
[![Desktop](https://img.shields.io/badge/Desktop-macOS%20%7C%20Windows-334155?style=flat-square)](docs/DESKTOP.md)
[![Node.js](https://img.shields.io/badge/Node.js-%E2%89%A5%2022.18-28735b?style=flat-square)](package.json)

[中文](README.md) · **English**

[Watch the tour](#product-tour) · [Quick start](#quick-start) · [User guide](docs/DOCTOR_WORKBENCH_GUIDE.md) · [Documentation](#documentation)

</div>

---

Open Medical is a local patient-management assistant for doctors. Keep clinical notes, lab results and follow-up records connected to the same patient. Organize guidelines, templates and useful cases in your own knowledge library, then retrieve, prepare and follow up through conversation.

**Keep records locally, connect your preferred model, and review the results.** Use local Ollama / vLLM servers, DeepSeek, OpenAI, Anthropic, OpenRouter or an OpenAI-compatible endpoint.

## Product tour

[![Open Medical product tour: patient records, follow-up and a personal knowledge library](docs/assets/open-medical-preview.gif)](https://github.com/JuneYaooo/open-medical-workbench/blob/main/docs/assets/open-medical-tour.mp4)

<p align="center">
  <a href="https://github.com/JuneYaooo/open-medical-workbench/blob/main/docs/assets/open-medical-tour.mp4"><strong>▶ Watch the full tour · 79 seconds · Chinese narration and subtitles</strong></a>
  <br />
  <sub>Click the preview to open the video. The tour uses sample records; some screens have changed in newer versions.</sub>
</p>

## A workbench for everyday care

| | What you can do |
| :--- | :--- |
| **Patient records** | Create patients or import a roster. Review diagnoses, medications, allergies and lab trends before a visit. |
| **Conversational preparation** | Add notes and reports, organize timelines, extract facts and prepare documents. Check sources before accepting proposed record changes. |
| **Follow-up and tracking** | Work through due follow-ups, tests and referrals. Record actual contact outcomes and schedule the next step. |
| **Personal knowledge** | Organize guidelines, templates and notes by purpose. Retrieve source passages and explore relationships in the knowledge graph. |
| **Cases and memory** | Save useful cases, find similar ones and reuse confirmed working preferences in later tasks. |
| **Messages and reminders** | Archive patient messages, connect doctor reminders through WeChat or Feishu, and authorize a Feishu bot to search shareable collections. |

### From a document to the next follow-up

1. **Bring in the material** — Select a patient and add a clinical note, report or existing document.
2. **Organize and review** — Extract facts, consult knowledge and check sources alongside proposed record changes.
3. **Save and follow up** — Save records, arrange follow-ups or test/referral tracking, and work through today's tasks.
4. **Build reusable context** — Bring useful sources, cases and confirmed preferences into future tasks.

Knowledge and preferences are reused through retrieval and context; they do not automatically train the model. See the [doctor workflow guide](docs/DOCTOR_WORKBENCH_GUIDE.md).

## Quick start

Requires **Node.js ≥ 22.18** and npm. Start locally, then connect a model when needed.

```bash
git clone https://github.com/JuneYaooo/open-medical-workbench.git
cd open-medical-workbench
npm ci
npm run build
npm start
```

Open [http://127.0.0.1:8787](http://127.0.0.1:8787). One local process serves the UI and API, binding only to the loopback interface by default.

**First steps:** Create a patient → add material → connect a model in Settings → start an organization task. Patient records, clinical entries and follow-up records can be managed without a model.

### Desktop app

Build a portable package on the corresponding operating system:

```bash
npm run package:mac    # macOS
npm run package:win    # Windows: build on Windows
```

Packages are written to `release/`. Open the `.app` on macOS or run `Open Medical.exe` from the complete portable folder on Windows. Desktop data is stored separately from development data. Closing the window can leave the app running in the background; quitting stops it. See [desktop setup](docs/DESKTOP.md) for installation, platform verification and signing limitations.

### Connect a model

Use **Settings → Model connections**, or copy `.env.example` to `.env`, configure `AI_PROVIDER` and the provider credentials, then restart.

| Connection | Use case |
| :--- | :--- |
| Local Ollama / vLLM | Use your own model server; offline operation requires the model and dependencies to be available locally. |
| DeepSeek / OpenAI / Anthropic / OpenRouter | Bring your own API key; usage is billed by the provider. |
| OpenAI-compatible endpoint | Configure a self-hosted or third-party endpoint and model ID. |

Context and output limits can be adjusted in model settings. External models receive authorized source material and relevant context; local storage does not make cloud inference local.

## Data and scope

- **Local storage.** Patient records, messages, follow-ups and conversations are stored in local SQLite. Model connection keys are encrypted in a local credential vault. **The patient database itself is not encrypted.**
- **Explicit authorization.** Model requests follow the scope authorized in the UI. Scheduled tasks and automatic follow-up summaries need separate authorization. File proposals and diffs are available; workspace settings determine the approval mode.
- **Doctor review.** AI output assists organization and preparation. Clinical effectiveness has not been validated, and output cannot replace professional judgment. Built-in medication and lab rules have limited coverage and do not provide comprehensive medication safety checks.
- **Single-doctor use.** Multi-user permissions, institution-grade audit, HIS / EMR / FHIR integration and institutional deployment validation are not implemented.

<details>
<summary><strong>Storage, backup and recovery</strong></summary>

Source installations default to `server/data/medical.sqlite`; override this with `MEDICAL_DATABASE`. Desktop builds use a separate system application-data directory; see [desktop setup](docs/DESKTOP.md).

```bash
npm run backup
```

Stop the service before recovery, point `MEDICAL_DATABASE` to a backup copy, and restart. Backups contain medical information and require the same protection as the original database. Deleting a patient also deletes their workspace and associated records; existing exports and backups remain.

</details>

## An extensible agent runtime

The medical workbench shares a general-purpose agent runtime for model/tool loops, file workspaces, conversation branches, scheduled tasks, context management and background execution. Extend it with Skills, MCP, plugins, browser tools, terminal tools and office-file helpers.

The generic runtime can run independently without loading the medical runtime or patient tables:

```bash
npm run build
npm run platform        # http://127.0.0.1:8788
```

Use `npm run dev` for frontend development and `npm run workspace --` for the standalone workspace CLI. Docker is optional and used for containerized terminal and some office tools. See the [capability matrix](docs/VALIDATION.md) and [runtime compatibility](RUNTIME_COMPATIBILITY.md) for supported scope.

## Documentation

Most detailed guides are currently in Chinese.

| Topic | Guide |
| :--- | :--- |
| First use and doctor workflows | [Doctor workflow guide](docs/DOCTOR_WORKBENCH_GUIDE.md) |
| Desktop installation, builds and data | [Desktop setup](docs/DESKTOP.md) |
| Doctor reminders and Feishu knowledge bot | [Connection guide](docs/doctor-assistant-channels.md) |
| WeChat, WeCom and message archiving | [Chat connectors](docs/chat-connectors.md) |
| Patient, message and follow-up data | [Patient management](docs/PATIENTS.md) |
| Architecture and extensions | [Architecture](docs/ARCHITECTURE.md) · [Generic runtime](docs/GENERIC_RUNTIME.md) · [Orchestration](docs/ORCHESTRATION.md) |
| Supported capabilities and verification | [Validation](docs/VALIDATION.md) · [Runtime compatibility](RUNTIME_COMPATIBILITY.md) |
| Private task queues and workers | [Remote deployment](deploy/remote/README.md) |

## Contributing

Report bugs or suggest improvements through [Issues](https://github.com/JuneYaooo/open-medical-workbench/issues), or contribute code and documentation through pull requests. Include reproduction steps, operating system and version information. Remove patient information and credentials before sharing.

Run checks locally for code changes. Live model verification requires your own model configuration:

```bash
npm run check           # Lint, tests and production build
npm run verify:model    # Live streaming, tool calls and continuation
```

## License

[MIT](LICENSE)
