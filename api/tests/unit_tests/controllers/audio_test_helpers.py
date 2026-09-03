"""Shared helpers for audio controller unit tests."""

from __future__ import annotations

import io

from werkzeug.datastructures import FileStorage

from models.model import App, AppMode


def make_audio_file() -> FileStorage:
    return FileStorage(stream=io.BytesIO(b"audio"), filename="audio.wav", content_type="audio/wav")


def make_chat_app(*, app_id: str = "a1", tenant_id: str = "tenant-1") -> App:
    return App(
        id=app_id,
        tenant_id=tenant_id,
        name="Audio app",
        description="",
        mode=AppMode.CHAT,
        enable_site=True,
        enable_api=True,
        max_active_requests=0,
    )
