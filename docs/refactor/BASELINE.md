# T0 基线记录（环境与现状）

> 本文件只记录执行 T0 时的环境、构建与 lint 现状，不包含任何修复。
> 记录时间：2026-10-29T05:50:40Z
> 分支：`refactor/plugin-host`
> 基线 commit：`23b0b8a`（Add plugin refactor execution plan）
> 工作区状态：干净（执行本任务前 `git status` 无改动）

## 1. 环境

| 项目 | 版本 / 值 |
| :--- | :--- |
| Node.js | `v24.22.2` |
| npm | `10.9.9` |
| 操作系统 | Linux（受限沙箱） |
| 项目版本 | `open-medical-agent@1.0.46` |
| 构建工具 | Vite `v8.2.2` |
| Lint 工具 | ESLint `^9.39.5`（flat config） |

## 2. 依赖安装方式

依赖由验收者预先安装，本次未执行 `npm ci` / `npm install`。安装命令为：

```bash
ELECTRON_SKIP_BINARY_DOWNLOAD=1 npm ci --ignore-scripts
node scripts/prepare-pdf-assets.mjs
node scripts/prepare-pty.mjs
```

说明：`--ignore-scripts` 跳过了 `postinstall`，因此随后手动执行了 `prepare-pdf-assets.mjs` 与 `prepare-pty.mjs`。
另外，`package.json` 的 `prebuild` 脚本本身也会执行这两个 prepare 脚本，所以 `npm run build` 会再次运行它们（属于正常现象）。

## 3. 命令结果

### 3.1 `npm run build`

- exit code：`0`
- 耗时：约 `875 ms`（命令整体，含 `prebuild` 的 pdf-assets / pty 准备；Vite 自身报告 `built in 682ms`）
- 关键输出：

```text
> open-medical-agent@1.0.46 prebuild
> node scripts/prepare-pdf-assets.mjs && node scripts/prepare-pty.mjs

> open-medical-agent@1.0.46 build
> vite build

vite v8.2.2 building client environment for production...
✓ 4389 modules transformed.
rendering chunks...
computing gzip size...
...
✓ built in 682ms

(!) Some chunks are larger than 500 kB after minification. Consider:
- Using dynamic import() to code-split the application
- Use build.rolldownOptions.output.codeSplitting to improve chunking
- Adjust chunk size limit for this warning via build.chunkSizeWarningLimit.
```

结论：build 成功，exit 0；存在 Vite 的“chunk 大于 500 kB”提示，不影响退出码，按要求只记录不处理。

### 3.2 `npm run lint`

- exit code：`0`
- 耗时：约 `2459 ms`
- 关键输出：

```text
> open-medical-agent@1.0.46 lint
> eslint .

```

（除 npm 脚本横幅外无任何输出，即无 lint 问题。）

- 错误数：`0`
- 警告数：`0`
- 检查文件数：`391`（以 `eslint . --format json` 复核，`errorCount=0`、`warningCount=0`、`filesWithMessages=0`）
- 失败规则与文件：无（lint 未失败，本条不适用）

结论：lint 当前通过，后续任务按“不新增 lint 错误/警告”执行。

## 4. 构建产物大小

`dist/` 为本次 build 生成，未做任何清理或额外处理。

- `dist/` 总大小：`12,228,827` 字节（约 `11.66 MiB` / `12.23 MB`；`du -sh` 因文件系统块取整显示为 `13M`）
- 文件数：`295`，其中 `.js` 文件 `106` 个

### 最大的 5 个 JS 文件

| 排名 | 文件 | 字节数 | 构建输出大小 |
| ---: | :--- | ---: | ---: |
| 1 | `dist/assets/medical-DbYSI8MR.js` | 1,519,925 | 1,519.92 kB（gzip 461.13 kB） |
| 2 | `dist/assets/elk-276RUBZZ-ByUIdEY9.js` | 1,456,410 | 1,456.41 kB（gzip 453.22 kB） |
| 3 | `dist/assets/exceljs.min-757jZ_6h.js` | 929,565 | 929.56 kB（gzip 256.44 kB） |
| 4 | `dist/assets/chunk-FOHPRMQF-CoA4358r.js` | 662,096 | 662.09 kB（gzip 143.16 kB） |
| 5 | `dist/assets/mammoth.browser-Cgjx0LNo.js` | 492,146 | 492.14 kB（gzip 118.79 kB） |

## 5. 备注

- 本次仅执行 T0：未修改任何源码、配置或测试，未运行 `npm test` / `npm run test:e2e`（不属于 T0 范围，且当前仓库尚无测试）。
- `node_modules/` 与 `dist/` 均为已存在/生成产物，不纳入提交。
