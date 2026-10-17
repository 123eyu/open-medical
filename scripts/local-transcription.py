#!/usr/bin/env python3
"""Authenticated loopback transcription using an already installed Whisper base."""
import argparse
import asyncio
import hashlib
import hmac
import json
import logging
import math
import os
from pathlib import Path
import tempfile

from fastapi import FastAPI, Request
from starlette.datastructures import UploadFile
from starlette.responses import JSONResponse

MODEL_ID = "whisper-base"
MAX_REQUEST_BYTES = 25 * 1024 * 1024
BASE_SHA256 = "ed3a0b6b1c0edf879ad9b11b1af5a0e6ab5db9205f891f668f8b0e6c6326e34e"
LOG = logging.getLogger("local-transcription")


def read_token(token_file=None):
    if token_file:
        path = Path(token_file)
        if path.stat().st_mode & 0o077:
            raise ValueError("Token file must be private (chmod 600).")
        if path.stat().st_size > 4096:
            raise ValueError("Token configuration is too large.")
        config = json.loads(path.read_text())
        if not isinstance(config, dict):
            raise ValueError("Token configuration must be a JSON object.")
        token = config.get("token", "")
    else:
        token = os.environ.get("LOCAL_TRANSCRIPTION_TOKEN", "")
    if not isinstance(token, str) or len(token) < 32 or not token.isascii() or any(c.isspace() for c in token):
        raise ValueError("Provide a random token of at least 32 ASCII characters via --token-file or LOCAL_TRANSCRIPTION_TOKEN.")
    return token


def failure(status, code, message):
    return JSONResponse({"error": {"code": code, "message": message}}, status_code=status)


class RequestBoundary:
    """Authenticate and bound the entire multipart body before parsing or loading it."""
    def __init__(self, app, token):
        self.app, self.token = app, token
        self.busy = False

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http":
            return await self.app(scope, receive, send)
        headers = dict(scope["headers"])
        authorization = headers.get(b"authorization", b"")
        if not hmac.compare_digest(authorization, ("Bearer " + self.token).encode("ascii")):
            return await failure(401, "unauthorized", "A valid Bearer token is required.")(scope, receive, send)
        transcription = scope["path"] == "/v1/audio/transcriptions" and scope["method"] == "POST"
        if not transcription:
            return await self.app(scope, receive, send)
        if self.busy:
            response = failure(503, "transcription_busy", "Another transcription is running; retry after it finishes.")
            response.headers["Retry-After"] = "5"
            return await response(scope, receive, send)
        self.busy = True
        try:
            try:
                declared = int(headers.get(b"content-length", b"0"))
            except ValueError:
                return await failure(400, "invalid_length", "Invalid Content-Length.")(scope, receive, send)
            if declared < 0 or declared > MAX_REQUEST_BYTES:
                return await failure(413, "request_too_large", "Multipart requests must not exceed 25 MiB.")(scope, receive, send)
            body = bytearray()
            while True:
                event = await receive()
                if event["type"] == "http.disconnect":
                    return
                chunk = event.get("body", b"")
                if len(body) + len(chunk) > MAX_REQUEST_BYTES:
                    return await failure(413, "request_too_large", "Multipart requests must not exceed 25 MiB.")(scope, receive, send)
                body.extend(chunk)
                if not event.get("more_body", False):
                    break
            delivered = False

            async def bounded_receive():
                nonlocal delivered
                if not delivered:
                    delivered = True
                    return {"type": "http.request", "body": bytes(body), "more_body": False}
                return await receive()

            await self.app(scope, bounded_receive, send)
        finally:
            self.busy = False


def create_app(transcribe, token, temp_dir=None):
    """The injectable callable is also used by offline boundary tests."""
    app = FastAPI(docs_url=None, redoc_url=None, openapi_url=None)
    app.add_middleware(RequestBoundary, token=token)

    @app.get("/health")
    async def health():
        return {"status": "ready", "model": MODEL_ID}

    @app.post("/v1/audio/transcriptions")
    async def transcription(request: Request):
        async with request.form(max_files=1, max_fields=6) as form:
            audio = form.get("file")
            if form.get("model") != MODEL_ID:
                return failure(400, "unsupported_model", "Only whisper-base is served.")
            if form.get("response_format", "json") not in ("json", "verbose_json"):
                return failure(400, "unsupported_format", "Use json or verbose_json.")
            if not isinstance(audio, UploadFile):
                return failure(400, "missing_audio", "Provide an audio file in multipart field file.")
            # The untrusted upload name and model are never used as filesystem paths.
            with tempfile.TemporaryDirectory(prefix="omw-asr-", dir=temp_dir) as folder:
                path = Path(folder) / "audio.m4a"
                with path.open("wb") as target:
                    while chunk := await audio.read(1024 * 1024):
                        target.write(chunk)
                if not path.stat().st_size:
                    return failure(400, "empty_audio", "The uploaded audio is empty.")
                # Keep the lock and temporary file until the worker has finished,
                # including cancellation of the HTTP request during inference.
                worker = asyncio.create_task(asyncio.to_thread(transcribe, str(path)))
                try:
                    result = await asyncio.shield(worker)
                except asyncio.CancelledError:
                    try:
                        await worker
                    except Exception:
                        LOG.exception("Transcription failed after request cancellation.")
                    raise
                except Exception:
                    LOG.exception("Local audio decoding or transcription failed.")
                    return failure(422, "transcription_failed", "Audio decoding or local transcription failed; inspect the service log.")
                try:
                    text = result["text"]
                    if not isinstance(text, str):
                        raise ValueError("invalid transcript text")
                    segments = []
                    for segment in result.get("segments", []):
                        start, end = float(segment["start"]), float(segment["end"])
                        if not math.isfinite(start) or not math.isfinite(end) or start < 0 or end < start or not isinstance(segment["text"], str):
                            raise ValueError("invalid transcript segment")
                        segments.append({"id": len(segments), "start": start, "end": end, "text": segment["text"]})
                    return {"text": text, "segments": segments, "language": result.get("language")}
                except (KeyError, ValueError, TypeError):
                    LOG.exception("Whisper returned invalid transcription data.")
                    return failure(500, "invalid_transcription", "The local model returned invalid transcription data.")
    return app


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--port", type=int, default=8766)
    parser.add_argument("--model-dir", type=Path, default=Path.home() / ".cache" / "whisper")
    parser.add_argument("--token-file", type=Path, help="Private JSON file containing a token field (mode 600).")
    parser.add_argument("--threads", type=int, default=4)
    parser.add_argument("--language", choices=("auto", "zh", "en"), default="auto")
    parser.add_argument("--temp-dir", type=Path)
    args = parser.parse_args()
    if not 1 <= args.port <= 65535 or not 1 <= args.threads <= 64:
        parser.error("Use port 1–65535 and threads 1–64.")
    try:
        token = read_token(args.token_file)
        weights = (args.model_dir / "base.pt").resolve(strict=True)
        with weights.open("rb") as source:
            digest = hashlib.file_digest(source, "sha256").hexdigest()
        if digest != BASE_SHA256:
            raise ValueError("base.pt does not match the official Whisper base checksum.")
    except (OSError, ValueError, json.JSONDecodeError) as error:
        parser.error(str(error))
    import torch
    import whisper
    import uvicorn
    torch.set_num_threads(args.threads)
    # Passing an existing verified file path avoids Whisper's model downloader.
    model = whisper.load_model(str(weights), device="cpu")

    def transcribe(path):
        return model.transcribe(path, fp16=False, language=None if args.language == "auto" else args.language, verbose=None)

    app = create_app(transcribe, token, args.temp_dir)
    uvicorn.run(app, host="127.0.0.1", port=args.port, workers=1, access_log=False)


if __name__ == "__main__":
    main()
