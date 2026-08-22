import base64
from types import SimpleNamespace
from unittest.mock import MagicMock

import pytest
from pytest_mock import MockerFixture

from core.app.entities.queue_entities import QueueNodeSucceededEvent, QueueTextChunkEvent
from core.base.tts.app_generator_tts_publisher import AppGeneratorTTSPublisher, AudioTrunk
from core.plugin.entities.plugin_daemon import TTSAudioChunk
from graphon.model_runtime.entities.model_entities import ModelPropertyKey
from graphon.model_runtime.errors.invoke import InvokeBadRequestError


@pytest.fixture
def mock_model_instance(mocker: MockerFixture):
    model = mocker.MagicMock()
    model.invoke_tts.return_value = [b"audio1", b"audio2"]
    model.get_tts_voices.return_value = [{"value": "voice1"}, {"value": "voice2"}]
    model.get_model_schema.return_value = SimpleNamespace(model_properties={ModelPropertyKey.AUDIO_TYPE: "mp3"})
    return model


@pytest.fixture
def mock_model_manager(mocker: MockerFixture, mock_model_instance: MagicMock):
    manager = mocker.MagicMock()
    manager.get_default_model_instance.return_value = mock_model_instance
    mocker.patch("core.base.tts.app_generator_tts_publisher.ModelManager.for_tenant", return_value=manager)
    return manager


@pytest.fixture(autouse=True)
def patch_threads(mocker: MockerFixture):
    """Run the worker explicitly in tests."""
    mocker.patch("threading.Thread.start", return_value=None)


def _text_event(text: str) -> MagicMock:
    event = MagicMock()
    event.event = MagicMock(spec=QueueTextChunkEvent)
    event.event.text = text
    return event


def _run(publisher: AppGeneratorTTSPublisher, *messages: MagicMock) -> None:
    for message in messages:
        publisher._msg_queue.put(message)
    publisher._msg_queue.put(None)
    publisher._runtime()


class TestAudioTrunk:
    def test_initialization(self):
        error = RuntimeError("failed")
        trunk = AudioTrunk("error", b"", error=error)

        assert trunk.status == "error"
        assert trunk.audio == b""
        assert trunk.error is error


class TestAppGeneratorTTSPublisher:
    def test_initialization_valid_voice(self, mock_model_manager):
        publisher = AppGeneratorTTSPublisher("tenant", "voice1")

        assert publisher.voice == "voice1"
        assert publisher.max_sentence == 2
        assert publisher.msg_text == ""

    def test_initialization_invalid_voice_fallback(self, mock_model_manager):
        publisher = AppGeneratorTTSPublisher("tenant", "invalid_voice")

        assert publisher.voice == "voice1"

    def test_publish_puts_message_in_queue(self, mock_model_manager):
        publisher = AppGeneratorTTSPublisher("tenant", "voice1")
        message = MagicMock()

        publisher.publish(message)

        assert publisher._msg_queue.get() == message

    def test_cancel_discards_queued_text(self, mock_model_manager, mock_model_instance: MagicMock):
        publisher = AppGeneratorTTSPublisher("tenant", "voice1")
        publisher.publish(_text_event("First. Second."))

        publisher.cancel()
        publisher._runtime()

        mock_model_instance.invoke_tts.assert_not_called()
        assert publisher._audio_queue.empty()

    def test_check_and_get_audio_returns_none_without_audio(self, mock_model_manager):
        publisher = AppGeneratorTTSPublisher("tenant", "voice1")

        assert publisher.check_and_get_audio() is None

    def test_check_and_get_audio_returns_the_resolved_mime_type(self, mock_model_manager):
        publisher = AppGeneratorTTSPublisher("tenant", "voice1")
        trunk = AudioTrunk("responding", b"abc", audio_type="audio/wav")
        publisher._audio_queue.put(trunk)

        result = publisher.check_and_get_audio()

        assert result is trunk
        assert result.audio_type == "audio/wav"

    @pytest.mark.parametrize("status", ["finish", "error"])
    def test_check_and_get_audio_caches_terminal_events(self, mock_model_manager, status: str):
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
    def test_extract_sentence(self, mock_model_manager, text, expected_sentences, expected_remaining):
        publisher = AppGeneratorTTSPublisher("tenant", "voice1")

        sentences, remaining = publisher._extract_sentence(text)

        assert sentences == expected_sentences
        assert remaining == expected_remaining

    def test_runtime_generates_the_final_buffer(self, mock_model_manager, mock_model_instance: MagicMock):
        publisher = AppGeneratorTTSPublisher("tenant", "voice1")
        publisher.msg_text = " Hello. "

        _run(publisher)

        mock_model_instance.invoke_tts.assert_called_once_with(content_text="Hello.", voice="voice1")
        assert publisher._audio_queue.get().audio == base64.b64encode(b"audio1")
        assert publisher._audio_queue.get().audio == base64.b64encode(b"audio2")
        assert publisher._audio_queue.get().status == "finish"

    def test_runtime_skips_an_empty_final_buffer(self, mock_model_manager, mock_model_instance: MagicMock):
        publisher = AppGeneratorTTSPublisher("tenant", "voice1")
        publisher.msg_text = "   "

        _run(publisher)

        mock_model_instance.invoke_tts.assert_not_called()
        assert publisher._audio_queue.get().status == "finish"

    def test_runtime_generates_incremental_mp3_after_the_sentence_threshold(
        self, mock_model_manager, mock_model_instance: MagicMock
    ):
        publisher = AppGeneratorTTSPublisher("tenant", "voice1")

        _run(publisher, _text_event("Hello world. Second sentence."))

        mock_model_instance.invoke_tts.assert_called_once_with(
            content_text="Hello world. Second sentence.", voice="voice1"
        )

    def test_runtime_waits_for_terminal_when_the_schema_has_no_audio_type(
        self, mock_model_manager, mock_model_instance: MagicMock
    ):
        mock_model_instance.get_model_schema.return_value = SimpleNamespace(model_properties={})
        wav = b"RIFF\x24\x00\x00\x00WAVEfmt \x10\x00\x00\x00audio-data"
        mock_model_instance.invoke_tts.return_value = [TTSAudioChunk(wav, "audio/wav")]
        publisher = AppGeneratorTTSPublisher("tenant", "voice1")
        event = _text_event("Hello. World.")
        messages = iter([event, None])

        def get_message():
            message = next(messages)
            if message is None:
                mock_model_instance.invoke_tts.assert_not_called()
            return message

        publisher._msg_queue = MagicMock()
        publisher._msg_queue.get.side_effect = get_message

        publisher._runtime()

        mock_model_instance.invoke_tts.assert_called_once_with(content_text="Hello. World.", voice="voice1")
        assert publisher._audio_queue.get().audio_type == "audio/wav"
        assert publisher._audio_queue.get().status == "finish"

    def test_runtime_waits_for_terminal_when_the_model_declares_wav(
        self, mock_model_manager, mock_model_instance: MagicMock
    ):
        mock_model_instance.get_model_schema.return_value = SimpleNamespace(
            model_properties={ModelPropertyKey.AUDIO_TYPE: "wav"}
        )
        publisher = AppGeneratorTTSPublisher("tenant", "voice1")

        _run(publisher, _text_event("Hello. World."))

        mock_model_instance.invoke_tts.assert_called_once_with(content_text="Hello. World.", voice="voice1")

    def test_runtime_rejects_a_non_mp3_incremental_response_before_emitting_audio(
        self, mock_model_manager, mock_model_instance: MagicMock
    ):
        wav = b"RIFF\x24\x00\x00\x00WAVEfmt \x10\x00\x00\x00audio-data"
        mock_model_instance.invoke_tts.return_value = [TTSAudioChunk(wav, "audio/wav")]
        publisher = AppGeneratorTTSPublisher("tenant", "voice1")

        _run(publisher, _text_event("First. Second. tail"))

        terminal = publisher._audio_queue.get()
        assert terminal.status == "error"
        assert isinstance(terminal.error, InvokeBadRequestError)
        assert publisher._audio_queue.empty()

    def test_runtime_rejects_mime_changes_between_audio_responses(
        self, mock_model_manager, mock_model_instance: MagicMock
    ):
        mp3 = b"\xff\xfb" + b"\x00" * 30
        wav = b"RIFF\x24\x00\x00\x00WAVEfmt \x10\x00\x00\x00audio-data"
        mock_model_instance.invoke_tts.side_effect = [
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
        self, mock_model_manager, mock_model_instance: MagicMock
    ):
        def failing_stream():
            raise RuntimeError("provider failed")
            yield b""  # pragma: no cover

        mock_model_instance.invoke_tts.return_value = failing_stream()
        publisher = AppGeneratorTTSPublisher("tenant", "voice1")
        publisher.msg_text = "Hello"

        _run(publisher)

        terminal = publisher._audio_queue.get()
        assert terminal.status == "error"
        assert isinstance(terminal.error, RuntimeError)
        assert publisher._audio_queue.empty()

    def test_runtime_handles_node_succeeded_output(self, mock_model_manager, mock_model_instance: MagicMock):
        publisher = AppGeneratorTTSPublisher("tenant", "voice1")
        event = MagicMock()
        event.event = MagicMock(spec=QueueNodeSucceededEvent)
        event.event.outputs = {"output": "Hello world."}

        _run(publisher, event)

        mock_model_instance.invoke_tts.assert_called_once()

    def test_runtime_ignores_node_succeeded_without_output(self, mock_model_manager, mock_model_instance: MagicMock):
        publisher = AppGeneratorTTSPublisher("tenant", "voice1")
        event = MagicMock()
        event.event = MagicMock(spec=QueueNodeSucceededEvent)
        event.event.outputs = None

        _run(publisher, event)

        mock_model_instance.invoke_tts.assert_not_called()

    def test_runtime_turns_message_processing_failure_into_an_error_terminal(self, mock_model_manager):
        publisher = AppGeneratorTTSPublisher("tenant", "voice1")
        publisher._msg_queue = MagicMock()
        publisher._msg_queue.get.side_effect = RuntimeError("failed")

        publisher._runtime()

        terminal = publisher._audio_queue.get()
        assert terminal.status == "error"
        assert isinstance(terminal.error, RuntimeError)
