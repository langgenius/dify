"""Audio operations for an admitted app, independent of its entry point."""

from typing import Protocol

from services.audio_types import AudioAppRef, AudioOutput, AudioUpload
from services.entities.message_entities import MessageActor


class AppAudio(Protocol):
    def transcript_asr(
        self, *, app: AudioAppRef, audio: AudioUpload | None, end_user: str | None = None
    ) -> dict[str, str]:
        """Transcribe an upload; end_user identifies the provider caller, or None for Console callers."""
        ...

    def transcript_tts(
        self,
        *,
        app: AudioAppRef,
        actor: MessageActor,
        text: str | None,
        voice: str | None,
        message_id: str | None,
        end_user: str | None = None,
    ) -> AudioOutput | None:
        """Synthesize a message answer or explicit text for the admitted app.

        A non-empty ``message_id`` takes precedence over ``text`` and selects
        a message belonging to this app and ``actor``. When ``message_id``
        is None or empty, ``text`` is required; None raises ValueError.

        Return None without invoking the provider when the message ID is not
        a valid UUID, no owned message exists, or its answer is empty while its
        status is NORMAL or PAUSED. This means no message audio is available;
        it does not fall back to ``text``. Configuration and provider failures
        raise their corresponding exceptions instead of returning None.

        ``end_user`` is the provider-facing user identifier, not the database
        identity used for message ownership. Console callers leave it as None.
        """
        ...
