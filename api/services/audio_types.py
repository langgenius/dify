"""Plain audio values shared by the application and provider boundary."""

from collections.abc import Iterable
from dataclasses import dataclass
from typing import IO


@dataclass(frozen=True, slots=True)
class AudioAppRef:
    """App identity and mode snapshot; tenant_id identifies the app's owner."""

    app_id: str
    tenant_id: str
    app_mode: str


@dataclass(frozen=True, slots=True)
class AudioUpload:
    stream: IO[bytes]
    mime_type: str


@dataclass(frozen=True, slots=True)
class AudioOutput:
    data: Iterable[bytes] | bytes | bytearray | memoryview
    mime_type: str | None
