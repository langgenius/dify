"""Audio operations for an admitted app, independent of its entry point."""

from typing import Protocol

from services.audio_types import AudioAppRef, AudioOutput, AudioUpload


class AppAudio(Protocol):
    def transcript_asr(self, *, app: AudioAppRef, audio: AudioUpload | None) -> dict[str, str]: ...

    def transcript_tts(
        self,
        *,
        app: AudioAppRef,
        account_id: str,
        text: str | None,
        voice: str | None,
        message_id: str | None,
    ) -> AudioOutput | None: ...
