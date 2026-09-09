"""Audio operations for an admitted installation, independent of HTTP and ORM."""

from collections.abc import Iterable
from dataclasses import dataclass
from typing import IO, Protocol

from services.installed_app_access_service import InstalledAppRef


@dataclass(frozen=True, slots=True)
class AudioUpload:
    stream: IO[bytes]
    mime_type: str


@dataclass(frozen=True, slots=True)
class AudioOutput:
    data: Iterable[bytes] | bytes | bytearray | memoryview
    mime_type: str | None


class InstalledAppAudio(Protocol):
    def transcript_asr(self, *, installed_app: InstalledAppRef, audio: AudioUpload | None) -> dict[str, str]: ...

    def transcript_tts(
        self,
        *,
        installed_app: InstalledAppRef,
        account_id: str,
        text: str | None,
        voice: str | None,
        message_id: str | None,
    ) -> AudioOutput | None: ...
