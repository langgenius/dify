"""Audio operations for an admitted app, independent of its entry point."""

from dataclasses import dataclass
from typing import Protocol

from services.audio_types import AudioAppRef, AudioOutput, AudioUpload, AudioVoice


@dataclass(frozen=True, slots=True)
class AgentTextToSpeechSource:
    """Existing runtime App and its owned message answer, if audio is available for it."""

    app: AudioAppRef
    message_answer: str | None


class AgentAudioStore(Protocol):
    """Read Agent audio configuration and message data in short, read-only sessions."""

    def get_agent_asr_enabled(self, *, app: AudioAppRef, agent_id: str, account_id: str, build: bool) -> bool:
        """Check the admitted App and return ASR availability for the selected draft.

        A changed or missing App raises AgentAppNotFoundError. A missing draft
        or fallback snapshot raises AgentConfigVersionMissingError.
        """
        ...

    def get_agent_tts_source(
        self, *, tenant_id: str, agent_id: str, account_id: str, message_id: str | None
    ) -> AgentTextToSpeechSource:
        """Require an existing runtime App and read the requested account-owned answer.

        None or an empty message ID requests only the App. Invalid, unavailable,
        and empty pending answers yield no answer. No backing App is created.
        """
        ...


class AppAudio(Protocol):
    def transcript_asr(self, *, app: AudioAppRef, audio: AudioUpload | None) -> dict[str, str]: ...

    def transcript_agent_asr(
        self,
        *,
        app: AudioAppRef,
        agent_id: str,
        account_id: str,
        build: bool,
        audio: AudioUpload | None,
    ) -> dict[str, str]:
        """Transcribe an upload for the admitted Agent App and selected debug draft.

        Build uses the account-owned draft. Reject a missing or changed target
        and release configuration reads before reading the upload or invoking ASR.
        """
        ...

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

    def transcript_agent_tts(
        self,
        *,
        tenant_id: str,
        agent_id: str,
        account_id: str,
        text: str | None,
        voice: str | None,
        message_id: str | None,
    ) -> AudioOutput | None:
        """Synthesize owned message audio or preview text on an existing Agent App.

        A non-empty message ID takes precedence over text. None means the
        selected message has no available audio. Preserve debug voice selection
        and never create a backing App.
        """
        ...

    def get_voices(self, *, tenant_id: str, language: str) -> list[AudioVoice]:
        """Discover voices for the tenant's default TTS model and language."""
        ...
