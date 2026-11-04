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
    ) -> AudioOutput | None:
        """Synthesize a message answer or explicit text for the admitted app.

        A non-empty ``message_id`` takes precedence over ``text`` and selects
        a message belonging to this app and ``account_id``. When ``message_id``
        is None or empty, ``text`` is required; None raises ValueError.

        Return None without invoking the provider when the message ID is not
        a valid UUID, no owned message exists, or its answer is empty while its
        status is NORMAL or PAUSED. This means no message audio is available;
        it does not fall back to ``text``. Configuration and provider failures
        raise their corresponding exceptions instead of returning None.
        """
        ...
