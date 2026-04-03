import base64
import queue
from unittest.mock import MagicMock

import pytest

from core.base.tts.app_generator_tts_publisher import (
    AppGeneratorTTSPublisher,
    AudioTrunk,
    _invoice_tts,
    _process_future,
)

# =========================
# Fixtures
# =========================


@pytest.fixture
def mock_model_instance(mocker):
    model = mocker.MagicMock()
    model.invoke_tts.return_value = [b"audio1", b"audio2"]
    model.get_tts_voices.return_value = [{"value": "voice1"}, {"value": "voice2"}]
    return model


@pytest.fixture
def mock_model_manager(mocker, mock_model_instance):
    manager = mocker.MagicMock()
    manager.get_default_model_instance.return_value = mock_model_instance
    mocker.patch("core.base.tts.app_generator_tts_publisher.ModelManager.for_tenant", return_value=manager)
    return manager


@pytest.fixture(autouse=True)
def patch_threads(mocker):
    """Prevent real threads from starting during tests"""
    mocker.patch("threading.Thread.start", return_value=None)


# =========================
# AudioTrunk Tests
# =========================


class TestAudioTrunk:
    def test_audio_trunk_initialization(self):
        trunk = AudioTrunk("responding", b"data")
        assert trunk.status == "responding"
        assert trunk.audio == b"data"


# =========================
# _invoice_tts Tests
# =========================


class TestInvoiceTTS:
    @pytest.mark.parametrize(
        "text",
        [None, "", "   "],
    )
    def test_invoice_tts_empty_or_none_returns_none(self, text, mock_model_instance):
        result = _invoice_tts(text, mock_model_instance, "voice1")
        assert result is None
        mock_model_instance.invoke_tts.assert_not_called()

    def test_invoice_tts_valid_text(self, mock_model_instance):
        result = _invoice_tts(" hello ", mock_model_instance, "voice1")
        mock_model_instance.invoke_tts.assert_called_once_with(
            content_text="hello",
            voice="voice1",
        )
        assert result == [b"audio1", b"audio2"]


# =========================
# _process_future Tests
# =========================


class TestProcessFuture:
    def test_process_future_normal_flow(self):
        future_queue = queue.Queue()
        audio_queue = queue.Queue()

        future = MagicMock()
        future.result.return_value = [b"abc"]

        future_queue.put(future)
        future_queue.put(None)

        _process_future(future_queue, audio_queue)

        first = audio_queue.get()
        assert first.status == "responding"
        assert first.audio == base64.b64encode(b"abc")

        finish = audio_queue.get()
        assert finish.status == "finish"

    def test_process_future_empty_result(self):
        future_queue = queue.Queue()
        audio_queue = queue.Queue()

        future = MagicMock()
        future.result.return_value = None

        future_queue.put(future)
        future_queue.put(None)

        _process_future(future_queue, audio_queue)

        finish = audio_queue.get()
        assert finish.status == "finish"

    def test_process_future_exception(self, mocker):
        future_queue = queue.Queue()
        audio_queue = queue.Queue()

        future = MagicMock()
        future.result.side_effect = Exception("error")

        future_queue.put(future)

        _process_future(future_queue, audio_queue)

        finish = audio_queue.get()
        assert finish.status == "finish"


# =========================
# AppGeneratorTTSPublisher Tests
# =========================


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

    def test_check_and_get_audio_no_audio(self, mock_model_manager):
        publisher = AppGeneratorTTSPublisher("tenant", "voice1")
        result = publisher.check_and_get_audio()
        assert result is None

    def test_check_and_get_audio_non_finish_event(self, mock_model_manager):
        publisher = AppGeneratorTTSPublisher("tenant", "voice1")
        trunk = AudioTrunk("responding", b"abc")
        publisher._audio_queue.put(trunk)

        result = publisher.check_and_get_audio()

        assert result.status == "responding"
        assert publisher._last_audio_event == trunk

    def test_check_and_get_audio_finish_event(self, mock_model_manager):
        publisher = AppGeneratorTTSPublisher("tenant", "voice1")
        publisher.executor = MagicMock()
        finish_trunk = AudioTrunk("finish", b"")
        publisher._audio_queue.put(finish_trunk)

        result = publisher.check_and_get_audio()

        assert result.status == "finish"
        publisher.executor.shutdown.assert_called_once()

    def test_check_and_get_audio_cached_finish(self, mock_model_manager):
        publisher = AppGeneratorTTSPublisher("tenant", "voice1")
        publisher.executor = MagicMock()
        publisher._last_audio_event = AudioTrunk("finish", b"")

        result = publisher.check_and_get_audio()

        assert result.status == "finish"
        publisher.executor.shutdown.assert_called_once()

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

    def test_runtime_handles_none_message_with_buffer(self, mock_model_manager):
        publisher = AppGeneratorTTSPublisher("tenant", "voice1")
        publisher.executor = MagicMock()
        publisher.msg_text = "Hello."

        publisher._msg_queue.put(None)
        publisher._runtime()

        publisher.executor.submit.assert_called_once()

    def test_runtime_handles_none_message_without_buffer(self, mock_model_manager):
        publisher = AppGeneratorTTSPublisher("tenant", "voice1")
        publisher.executor = MagicMock()
        publisher.msg_text = "   "

        publisher._msg_queue.put(None)
        publisher._runtime()

        publisher.executor.submit.assert_not_called()

    def test_runtime_sentence_threshold_triggers_submit(self, mock_model_manager, mocker):
        publisher = AppGeneratorTTSPublisher("tenant", "voice1")
        publisher.executor = MagicMock()

        # Force sentence extraction to hit threshold condition
        mocker.patch.object(
            publisher,
            "_extract_sentence",
            return_value=(["Hello world.", " Second sentence."], ""),
        )

        from core.app.entities.queue_entities import QueueTextChunkEvent

        event = MagicMock()
        event.event = MagicMock(spec=QueueTextChunkEvent)
        event.event.text = "Hello world. Second sentence."

        publisher._msg_queue.put(event)
        publisher._msg_queue.put(None)

        publisher._runtime()

        assert publisher.executor.submit.called

    def test_runtime_handles_text_chunk_event(self, mock_model_manager):
        publisher = AppGeneratorTTSPublisher("tenant", "voice1")
        publisher.executor = MagicMock()

        from core.app.entities.queue_entities import QueueTextChunkEvent

        event = MagicMock()
        event.event = MagicMock(spec=QueueTextChunkEvent)
        event.event.text = "Hello world."

        publisher._msg_queue.put(event)
        publisher._msg_queue.put(None)

        publisher._runtime()

        assert publisher.executor.submit.called

    def test_runtime_handles_node_succeeded_event_with_output(self, mock_model_manager):
        publisher = AppGeneratorTTSPublisher("tenant", "voice1")
        publisher.executor = MagicMock()

        from core.app.entities.queue_entities import QueueNodeSucceededEvent

        event = MagicMock()
        event.event = MagicMock(spec=QueueNodeSucceededEvent)
        event.event.outputs = {"output": "Hello world."}

        publisher._msg_queue.put(event)
        publisher._msg_queue.put(None)

        publisher._runtime()

        assert publisher.executor.submit.called

    def test_runtime_handles_node_succeeded_event_without_output(self, mock_model_manager):
        publisher = AppGeneratorTTSPublisher("tenant", "voice1")
        publisher.executor = MagicMock()

        from core.app.entities.queue_entities import QueueNodeSucceededEvent

        event = MagicMock()
        event.event = MagicMock(spec=QueueNodeSucceededEvent)
        event.event.outputs = None

        publisher._msg_queue.put(event)
        publisher._msg_queue.put(None)

        publisher._runtime()

        publisher.executor.submit.assert_not_called()

    def test_runtime_handles_agent_message_event_list_content(self, mock_model_manager, mocker):
        publisher = AppGeneratorTTSPublisher("tenant", "voice1")
        publisher.executor = MagicMock()

        from graphon.model_runtime.entities.llm_entities import LLMResultChunk, LLMResultChunkDelta
        from graphon.model_runtime.entities.message_entities import (
            AssistantPromptMessage,
            ImagePromptMessageContent,
            TextPromptMessageContent,
        )

        from core.app.entities.queue_entities import QueueAgentMessageEvent

        chunk = LLMResultChunk(
            model="model",
            delta=LLMResultChunkDelta(
                index=0,
                message=AssistantPromptMessage(
                    content=[
                        TextPromptMessageContent(data="Hello "),
                        ImagePromptMessageContent(format="png", mime_type="image/png", base64_data="a"),
                    ]
                ),
            ),
        )
        event = MagicMock(event=QueueAgentMessageEvent(chunk=chunk))

        mocker.patch.object(publisher, "_extract_sentence", return_value=([], ""))

        publisher._msg_queue.put(event)
        publisher._msg_queue.put(None)

        publisher._runtime()

        assert publisher.msg_text == "Hello "

    def test_runtime_handles_agent_message_event_empty_content(self, mock_model_manager, mocker):
        publisher = AppGeneratorTTSPublisher("tenant", "voice1")
        publisher.executor = MagicMock()

        from graphon.model_runtime.entities.llm_entities import LLMResultChunk, LLMResultChunkDelta
        from graphon.model_runtime.entities.message_entities import AssistantPromptMessage

        from core.app.entities.queue_entities import QueueAgentMessageEvent

        chunk = LLMResultChunk(
            model="model",
            delta=LLMResultChunkDelta(
                index=0,
                message=AssistantPromptMessage(content=""),
            ),
        )
        event = MagicMock(event=QueueAgentMessageEvent(chunk=chunk))

        mocker.patch.object(publisher, "_extract_sentence", return_value=([], ""))

        publisher._msg_queue.put(event)
        publisher._msg_queue.put(None)

        publisher._runtime()

        assert publisher.msg_text == ""

    def test_runtime_resets_msg_text_when_text_tmp_not_str(self, mock_model_manager, mocker):
        publisher = AppGeneratorTTSPublisher("tenant", "voice1")
        publisher.executor = MagicMock()

        from core.app.entities.queue_entities import QueueTextChunkEvent

        event = MagicMock()
        event.event = MagicMock(spec=QueueTextChunkEvent)
        event.event.text = "Hello world. Another sentence."

        mocker.patch.object(publisher, "_extract_sentence", return_value=(["A.", "B."], None))

        publisher._msg_queue.put(event)
        publisher._msg_queue.put(None)

        publisher._runtime()

        assert publisher.msg_text == ""

    def test_runtime_exception_path(self, mock_model_manager):
        publisher = AppGeneratorTTSPublisher("tenant", "voice1")
        publisher._msg_queue = MagicMock()
        publisher._msg_queue.get.side_effect = Exception("error")

        publisher._runtime()
