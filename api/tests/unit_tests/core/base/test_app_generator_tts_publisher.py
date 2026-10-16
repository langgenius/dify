import base64
from collections.abc import Iterator

import pytest
from pytest_mock import MockerFixture

from core.app.entities.queue_entities import (
    MessageQueueMessage,
    QueueNodeSucceededEvent,
    QueueTextChunkEvent,
    WorkflowQueueMessage,
)
from core.base.tts.app_generator_tts_publisher import AppGeneratorTTSPublisher, AudioTrunk
from core.credit_usage import CreditUsageAppType, CreditUsageCreatedBy
from core.model_manager import ModelInstance, ModelManager
from core.plugin.entities.plugin_daemon import TTSAudioChunk
from graphon.enums import BuiltinNodeTypes
from graphon.model_runtime.entities.model_entities import ModelPropertyKey
from graphon.model_runtime.errors.invoke import InvokeBadRequestError
from libs.datetime_utils import naive_utc_now
from models.model import AppMode
from tests.unit_tests.audio_runtime_fixtures import AudioRuntimeObservations


@pytest.fixture(autouse=True)
def audio_responses(audio_runtime: AudioRuntimeObservations) -> None:
    audio_runtime.tts_result = [b"audio1", b"audio2"]
    audio_runtime.voices = [{"name": "One", "value": "voice1"}, {"name": "Two", "value": "voice2"}]


@pytest.fixture(autouse=True)
def patch_threads(mocker: MockerFixture) -> None:
    """Run the worker explicitly in tests."""
    mocker.patch("threading.Thread.start", return_value=None)


def _text_event(text: str) -> WorkflowQueueMessage:
    return WorkflowQueueMessage(task_id="task", app_mode=AppMode.WORKFLOW, event=QueueTextChunkEvent(text=text))


def _node_event(outputs: dict[str, object] | None) -> WorkflowQueueMessage:
    event = QueueNodeSucceededEvent(
        node_execution_id="execution",
        node_id="node",
        node_type=BuiltinNodeTypes.END,
        start_at=naive_utc_now(),
        outputs=outputs or {},
    )
    if outputs is None:
        # Preserve the publisher's legacy null-output guard beyond the current schema.
        event = event.model_copy(update={"outputs": None})
    return WorkflowQueueMessage(task_id="task", app_mode=AppMode.WORKFLOW, event=event)


def _run(publisher: AppGeneratorTTSPublisher, *messages: WorkflowQueueMessage) -> None:
    for message in messages:
        publisher._msg_queue.put(message)
    publisher._msg_queue.put(None)
    publisher._runtime()


class TestAudioTrunk:
    def test_initialization(self) -> None:
        error = RuntimeError("failed")
        trunk = AudioTrunk("error", b"", error=error)

        assert trunk.status == "error"
        assert trunk.audio == b""
        assert trunk.error is error


class TestAppGeneratorTTSPublisher:
    def test_initialization_valid_voice(self, audio_runtime: AudioRuntimeObservations) -> None:
        publisher = AppGeneratorTTSPublisher("tenant", "voice1")

        assert type(publisher.model_manager) is ModelManager
        assert type(publisher.model_instance) is ModelInstance
        assert publisher.model_instance.credentials == {"api_key": "audio-token"}
        assert publisher.voice == "voice1"
        assert publisher.max_sentence == 2
        assert publisher.msg_text == ""

    def test_initialization_invalid_voice_fallback(self, audio_runtime: AudioRuntimeObservations) -> None:
        publisher = AppGeneratorTTSPublisher("tenant", "invalid_voice")

        assert publisher.voice == "voice1"

    def test_publish_puts_message_in_queue(self, audio_runtime: AudioRuntimeObservations) -> None:
        publisher = AppGeneratorTTSPublisher("tenant", "voice1")
        message = _text_event("queued text")

        publisher.publish(message)

        assert publisher._msg_queue.get() == message

    def test_cancel_discards_queued_text(self, audio_runtime: AudioRuntimeObservations) -> None:
        publisher = AppGeneratorTTSPublisher("tenant", "voice1")
        publisher.publish(_text_event("First. Second."))

        publisher.cancel()
        publisher._runtime()

        assert audio_runtime.tts_calls == []
        assert publisher._audio_queue.empty()

    def test_check_and_get_audio_returns_none_without_audio(self, audio_runtime: AudioRuntimeObservations) -> None:
        publisher = AppGeneratorTTSPublisher("tenant", "voice1")

        assert publisher.check_and_get_audio() is None

    def test_check_and_get_audio_returns_the_resolved_mime_type(self, audio_runtime: AudioRuntimeObservations) -> None:
        publisher = AppGeneratorTTSPublisher("tenant", "voice1")
        trunk = AudioTrunk("responding", b"abc", audio_type="audio/wav")
        publisher._audio_queue.put(trunk)

        result = publisher.check_and_get_audio()

        assert result is trunk
        assert result.audio_type == "audio/wav"

    @pytest.mark.parametrize("status", ["finish", "error"])
    def test_check_and_get_audio_caches_terminal_events(
        self, audio_runtime: AudioRuntimeObservations, status: str
    ) -> None:
        publisher = AppGeneratorTTSPublisher("tenant", "voice1")
        terminal = AudioTrunk(status, b"", error=RuntimeError("failed") if status == "error" else None)
        publisher._audio_queue.put(terminal)

        assert publisher.check_and_get_audio(block=True) is terminal
        assert publisher.check_and_get_audio() is terminal

    @pytest.mark.parametrize(
        ("text", "expected_sentences", "expected_remaining"),
        [
            ("Hello world.", ["Hello world."], ""),
            ("Hello world! How are you?", ["Hello world!", " How are you?"], ""),
            ("No punctuation", [], "No punctuation"),
            ("", [], ""),
        ],
    )
    def test_extract_sentence(
        self, audio_runtime: AudioRuntimeObservations, text: str, expected_sentences: list[str], expected_remaining: str
    ) -> None:
        publisher = AppGeneratorTTSPublisher("tenant", "voice1")

        sentences, remaining = publisher._extract_sentence(text)

        assert sentences == expected_sentences
        assert remaining == expected_remaining

    def test_runtime_generates_the_final_buffer(self, audio_runtime: AudioRuntimeObservations) -> None:
        publisher = AppGeneratorTTSPublisher("tenant", "voice1")
        publisher.msg_text = " Hello. "

        _run(publisher)

        assert audio_runtime.tts_calls == [{"content_text": "Hello.", "voice": "voice1"}]
        assert len(audio_runtime.runtime_calls) == 1
        assert audio_runtime.runtime_calls[0]["request_metadata"] == {
            "app_type": CreditUsageAppType.UNKNOWN,
            "created_by": CreditUsageCreatedBy.AUDIO,
        }
        assert audio_runtime.manager_requests[0]["user_id"] == "responding_tts"
        assert publisher._audio_queue.get().audio == base64.b64encode(b"audio1")
        assert publisher._audio_queue.get().audio == base64.b64encode(b"audio2")
        assert publisher._audio_queue.get().status == "finish"

    def test_runtime_skips_an_empty_final_buffer(self, audio_runtime: AudioRuntimeObservations) -> None:
        publisher = AppGeneratorTTSPublisher("tenant", "voice1")
        publisher.msg_text = "   "

        _run(publisher)

        assert audio_runtime.tts_calls == []
        assert publisher._audio_queue.get().status == "finish"

    def test_runtime_generates_incremental_mp3_after_the_sentence_threshold(
        self, audio_runtime: AudioRuntimeObservations
    ) -> None:
        publisher = AppGeneratorTTSPublisher("tenant", "voice1")

        _run(publisher, _text_event("Hello world. Second sentence."))

        assert audio_runtime.tts_calls == [{"content_text": "Hello world. Second sentence.", "voice": "voice1"}]

    def test_runtime_waits_for_terminal_when_the_schema_has_no_audio_type(
        self, audio_runtime: AudioRuntimeObservations, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        audio_runtime.model_properties = {}
        wav = b"RIFF\x24\x00\x00\x00WAVEfmt \x10\x00\x00\x00audio-data"
        audio_runtime.tts_result = [TTSAudioChunk(wav, "audio/wav")]
        publisher = AppGeneratorTTSPublisher("tenant", "voice1")
        event = _text_event("Hello. World.")
        publisher._msg_queue.put(event)
        publisher._msg_queue.put(None)
        original_get = publisher._msg_queue.get

        def get_message() -> WorkflowQueueMessage | MessageQueueMessage | None:
            message = original_get()
            if message is None:
                assert audio_runtime.tts_calls == []
            return message

        monkeypatch.setattr(publisher._msg_queue, "get", get_message)

        publisher._runtime()

        assert audio_runtime.tts_calls == [{"content_text": "Hello. World.", "voice": "voice1"}]
        assert publisher._audio_queue.get().audio_type == "audio/wav"
        assert publisher._audio_queue.get().status == "finish"

    def test_runtime_waits_for_terminal_when_the_model_declares_wav(
        self, audio_runtime: AudioRuntimeObservations
    ) -> None:
        audio_runtime.model_properties = {ModelPropertyKey.AUDIO_TYPE: "wav"}
        publisher = AppGeneratorTTSPublisher("tenant", "voice1")

        _run(publisher, _text_event("Hello. World."))

        assert audio_runtime.tts_calls == [{"content_text": "Hello. World.", "voice": "voice1"}]

    def test_runtime_rejects_a_non_mp3_incremental_response_before_emitting_audio(
        self, audio_runtime: AudioRuntimeObservations
    ) -> None:
        wav = b"RIFF\x24\x00\x00\x00WAVEfmt \x10\x00\x00\x00audio-data"
        audio_runtime.tts_result = [TTSAudioChunk(wav, "audio/wav")]
        publisher = AppGeneratorTTSPublisher("tenant", "voice1")

        _run(publisher, _text_event("First. Second. tail"))

        terminal = publisher._audio_queue.get()
        assert terminal.status == "error"
        assert isinstance(terminal.error, InvokeBadRequestError)
        assert publisher._audio_queue.empty()

    def test_runtime_rejects_mime_changes_between_audio_responses(
        self, audio_runtime: AudioRuntimeObservations
    ) -> None:
        mp3 = b"\xff\xfb" + b"\x00" * 30
        wav = b"RIFF\x24\x00\x00\x00WAVEfmt \x10\x00\x00\x00audio-data"
        audio_runtime.tts_responses = [
            [TTSAudioChunk(mp3, "audio/mpeg")],
            [TTSAudioChunk(wav, "audio/wav")],
        ]
        publisher = AppGeneratorTTSPublisher("tenant", "voice1")

        _run(publisher, _text_event("First. Second. tail"))

        responding = publisher._audio_queue.get()
        terminal = publisher._audio_queue.get()
        assert responding.status == "responding"
        assert terminal.status == "error"
        assert isinstance(terminal.error, InvokeBadRequestError)
        assert "between audio responses" in str(terminal.error)
        assert publisher._audio_queue.empty()

    def test_runtime_turns_a_lazy_provider_failure_into_an_error_terminal(
        self, audio_runtime: AudioRuntimeObservations
    ) -> None:
        def failing_stream() -> Iterator[bytes]:
            raise RuntimeError("provider failed")
            yield b""  # pragma: no cover

        audio_runtime.tts_result = failing_stream()
        publisher = AppGeneratorTTSPublisher("tenant", "voice1")
        publisher.msg_text = "Hello"

        _run(publisher)

        terminal = publisher._audio_queue.get()
        assert terminal.status == "error"
        assert isinstance(terminal.error, RuntimeError)
        assert publisher._audio_queue.empty()

    def test_runtime_handles_node_succeeded_output(self, audio_runtime: AudioRuntimeObservations) -> None:
        publisher = AppGeneratorTTSPublisher("tenant", "voice1")
        event = _node_event({"output": "Hello world."})

        _run(publisher, event)

        assert len(audio_runtime.tts_calls) == 1

    def test_runtime_ignores_node_succeeded_without_output(self, audio_runtime: AudioRuntimeObservations) -> None:
        publisher = AppGeneratorTTSPublisher("tenant", "voice1")
        event = _node_event(None)

        _run(publisher, event)

        assert audio_runtime.tts_calls == []

    def test_runtime_turns_message_processing_failure_into_an_error_terminal(
        self, audio_runtime: AudioRuntimeObservations, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        publisher = AppGeneratorTTSPublisher("tenant", "voice1")

        def unavailable() -> None:
            raise RuntimeError("failed")

        monkeypatch.setattr(publisher._msg_queue, "get", unavailable)

        publisher._runtime()

        terminal = publisher._audio_queue.get()
        assert terminal.status == "error"
        assert isinstance(terminal.error, RuntimeError)
