# 本机 Whisper 转写

`scripts/local-transcription.py` 提供可选的本机音频转写服务，供知识库音视频导入使用。它使用 CPU 运行已安装的 Whisper base，只监听 `127.0.0.1`，不包含模型下载或后台安装功能。

运行环境需已有 Python、`openai-whisper`、PyTorch、FastAPI、python-multipart、Uvicorn，以及 PATH 中可用的 FFmpeg。将官方 Whisper base 权重 `base.pt` 放入模型目录；启动时会核验 SHA256：

```text
ed3a0b6b1c0edf879ad9b11b1af5a0e6ab5db9205f891f668f8b0e6c6326e34e
```

先使用运行服务的 Python 创建私有配置文件。以下命令不会输出密钥：

```sh
python - <<'PY'
import json, os, secrets
from pathlib import Path
path = Path.home() / '.config' / 'open-medical' / 'transcription.json'
path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
with os.fdopen(fd, 'w') as out:
    json.dump({'token': secrets.token_urlsafe(48)}, out)
PY
```

启动服务（将 `python` 换成安装了上述依赖的解释器）：

```sh
python scripts/local-transcription.py \
  --model-dir "$HOME/.cache/whisper" \
  --token-file "$HOME/.config/open-medical/transcription.json" \
  --port 8766 --threads 4 --language zh
```

`--language auto` 启用语言自动识别，`en` 用于英语。`--temp-dir` 可指定临时目录；默认使用系统临时目录。也可以通过 `LOCAL_TRANSCRIPTION_TOKEN` 环境变量提供随机密钥，长度至少 32 个 ASCII 字符。配置文件必须禁止其他用户读取，例如权限 `600`。

在「设置 → 工具与服务 → 音视频转写」中配置：

| 字段 | 值 |
| --- | --- |
| 转写服务位置 | 本机服务 |
| 接口地址 | `http://127.0.0.1:8766/v1` |
| 模型 | `whisper-base` |
| 转写访问密钥 | 私有配置文件中的 `token` 值 |

服务实现 `POST /v1/audio/transcriptions`，接收 multipart 的 `file`、`model`、`response_format` 字段。支持产品生成的 m4a 分段音频，返回实际转写的 `text` 和含 `start`、`end`、`text` 的 `segments`。`json` 和 `verbose_json` 均保留分段时间戳。

`GET /health` 返回就绪状态与模型名称。健康检查和转写请求都必须带 `Authorization: Bearer <token>`。健康状态只在权重加载完成后可用；转写过程仍可能因音频损坏或 FFmpeg 不可用而失败。

每次完整 multipart 请求最多 25 MiB（包括表单开销）。同一时间只处理一个请求，忙碌时返回 HTTP 503 和 `Retry-After: 5`，完成后可重试。缺少或错误密钥返回 401，超限返回 413；无法解码或推理失败返回错误，不生成替代转写。运行日志写入标准错误，不记录密钥或请求正文。

服务停止后，未完成的导入可在服务重启并恢复连接后重试。临时音频在请求完成或失败后清理；系统强制终止进程时可能留下系统临时目录中的 `omw-asr-*` 目录，可在确认服务停止后删除。

保存连接后返回知识库，在原任务上继续导入，无需重新上传音频。语音识别可能误识同音字、药名和数字；整理知识与引用前应对照音频核对正文。没有可用转写服务时，可在原任务中补充文字稿；纯文本不生成虚构的逐句时间戳，带时间轴的 SRT/VTT 会校验时间范围。

已完成的转写可在资料阅读页的「更多 → 修正正文」中纠错。保存会保留原文件并重新索引，旧图谱与旧时间定位失效，需要重新生成图谱和审核来源。遇到其他窗口已修改的版本，界面会显示服务器最新正文供合并，不自动覆盖。保存失败时保留当前编辑草稿；离开前应确认保存结果。
