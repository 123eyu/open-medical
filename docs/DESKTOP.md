# Open Medical 桌面应用

Open Medical 通过 macOS / Windows 桌面窗口提供工作台。应用打包 Chromium、Node.js、UI、本地医疗运行时和技能，启动时自动运行本地服务；使用安装包不需要另装 Node.js、npm 或项目源码。

## 安装与启动

- **macOS：** 将 `Open Medical.app` 复制到「应用程序」后打开。
- **Windows：** 保留完整的 `Open Medical-win32-x64` 便携目录，运行其中的 `Open Medical.exe`。不能只复制可执行文件。
- **源码启动：** 安装 Node.js ≥ 22.18 后运行 `npm ci`、`npm run build`、`npm start`。`desktop`、`agent`、`harness` 命令也会打开同一个桌面应用。

启动后可先使用「示例体验」浏览功能。没有模型连接也能管理患者档案、登记资料和随访。模型计算需要配置本地 Ollama / vLLM 或外部服务；外部模型会接收获授权的材料。包内不会自动下载模型、依赖或更新。Python 沙箱和部分工具另有运行环境要求，见 [运行时兼容说明](../RUNTIME_COMPATIBILITY.md)。

## 窗口与后台任务

macOS 关闭窗口后应用继续运行，可以从 Dock 或「工作台 → 打开工作窗口」返回。Windows 托盘就绪时，关闭窗口会隐藏窗口，可以点击托盘重新打开；托盘无法创建时关闭最后一个窗口会退出应用。托盘的「隐藏窗口（后台任务继续）」只隐藏窗口。

退出应用（macOS 的 Cmd+Q 或托盘退出命令）会停止后台任务并安全关闭数据库。需要计划任务和到期提醒时，请保持应用运行；可在 **设置 → 桌面应用** 开启登录启动和系统提醒。

PDF 导出使用系统保存对话框；选择工作文件夹也使用原生目录选择器。外部文献和帮助链接由系统浏览器打开，工作台本身在应用内使用。

## 数据与模型配置

源码启动和安装包使用相同的桌面数据位置：

| 内容 | 位置与入口 |
| --- | --- |
| 患者数据库 | `~/.open-medical-workbench/medical.sqlite`；Windows 中 `~` 为当前用户主目录 |
| 数据目录 | 设置 → 桌面应用 → 应用维护 → 打开数据目录 |
| 模型配置 | 配置目录中的 `model.env`，首次创建权限为 0600 |
| 配置目录 | 设置 → 桌面应用 → 应用维护 → 打开配置目录 |

macOS 配置目录通常为 `~/Library/Application Support/Open Medical Workbench/`；Windows 为 `%APPDATA%/Open Medical Workbench/`。模型连接也可在应用设置中管理。手动编辑 `model.env` 后重启应用生效；桌面启动不会读取项目 `.env`。

旧版应用数据在新位置不存在时迁移，已有数据不会被覆盖。开发调试服务默认使用项目内 `server/data/medical.sqlite`，不会自动合并到桌面数据库。打包排除项目数据库、密钥、测试材料和截图。

## 备份与恢复

在源码目录运行：

```bash
npm run backup
```

默认备份桌面患者数据库，生成在 `~/.open-medical-workbench/backups/`。可在命令后指定目标文件；开发者可用 `MEDICAL_DATABASE` 显式指定其他源数据库。备份使用 SQLite 一致性快照，包含已经提交的 WAL 数据，拒绝覆盖已有目标。

数据库备份不包含外部项目文件、独立知识库文件及模型配置；这些资料应另行保管。恢复时：

1. 完全退出应用，确保后台已停止。
2. 将现有 `medical.sqlite` 及同名 `-wal`、`-shm` 文件（若有）一起移到保留目录。
3. 将备份副本复制到数据目录并命名为 `medical.sqlite`，保留原备份不动。
4. 重新打开应用，核对患者和记录。

备份与原数据库都包含医疗资料，应按同等标准保管。不要删除仍在使用的数据库或将旧 WAL 与恢复后的数据库混用。

## 构建桌面包

```bash
npm ci
npm run package:mac
```

Windows 构建使用 `npm run package:win`。`npm run package:desktop` 按当前平台生成包；`TARGET_PLATFORM` / `TARGET_ARCH` 或 `--platform` / `--arch` 可指定目标。跨平台构建需要对应的 Electron runtime 缓存或网络下载；生成目录不等于已在目标系统验证。

输出位于 `release/Open Medical-darwin-arm64/Open Medical.app` 或 `release/Open Medical-win32-x64/`。Intel Mac 需要相应架构的构建与验证。macOS 包尚未做 Apple Developer ID 公证；Windows 包尚未做代码签名。当前为便携包，不包含 MSI 安装器。

macOS 构建成功后会整理 `output/` 中符合条件的旧回退包，保留最新一份；正在使用、生成不足一小时或包含本地数据的副本会保留。`npm run desktop:prune` 可预览，`npm run desktop:prune -- --apply` 执行清理。

## 开发调试

浏览器入口只用于显式开发调试：

```bash
npm run dev:server     # 医疗开发 API + 已构建的 UI：127.0.0.1:8787
npm run dev:ui         # 另一个终端启动 Vite，API 代理到 8787
npm run dev:platform   # 通用界面开发服务：127.0.0.1:8788
```

开发服务可读取项目 `.env`，医疗开发库默认位于 `server/data/medical.sqlite`，可用 `MEDICAL_DATABASE` 覆盖。`npm run platform` 和 `npm run daemon -- start` 仅提供通用后台 API，不发布工作台页面；CLI 入口为 `npm run workspace --`。

桌面应用始终监听随机本机端口。主进程仅向自己的工作窗口请求添加本次启动凭据；外部浏览器无法获取页面和 bootstrap 会话凭据。API 仍校验独立会话令牌，消息接入和企业微信回调沿用各自的认证方式。渲染进程启用 sandbox、context isolation，不开放 Node API、webview 或任意页面导航。该机制用于限制入口，不替代操作系统账户和文件权限。
