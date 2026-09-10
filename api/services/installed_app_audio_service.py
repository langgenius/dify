"""Audio operations for an admitted installation, independent of HTTP and ORM."""

from typing import Protocol

from services.audio_types import AudioOutput, AudioUpload
from services.installed_app_access_service import InstalledAppRef


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
