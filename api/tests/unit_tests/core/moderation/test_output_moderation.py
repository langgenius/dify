from collections.abc import Callable
from unittest.mock import MagicMock, create_autospec, patch

import pytest
from flask import Flask
from pytest_mock import MockerFixture

from configs.feature import ModerationConfig
from core.app.apps.base_app_queue_manager import AppQueueManager, PublishFrom
from core.app.apps.message_based_app_queue_manager import MessageBasedAppQueueManager
from core.app.entities.app_invoke_entities import InvokeFrom
from core.app.entities.queue_entities import QueueMessageReplaceEvent
from core.app.entities.task_entities import MessageReplaceStreamResponse, MessageStreamResponse
from core.extension.extensible import ModuleExtension
from core.extension.extension import Extension
from core.moderation.base import ModerationAction, ModerationOutputsResult
from core.moderation.keywords.keywords import KeywordsModeration
from core.moderation.output_moderation import ModerationRule, OutputModeration
from models.model import AppMode


def _publish_mock(manager: MessageBasedAppQueueManager) -> MagicMock:
    assert isinstance(manager.publish, MagicMock)
    return manager.publish


class TestOutputModeration:
    @pytest.fixture
    def queue_manager(self, mocker: MockerFixture) -> MessageBasedAppQueueManager:
        with patch("core.app.apps.base_app_queue_manager.redis_client.setex"):
            manager = MessageBasedAppQueueManager(
                task_id="test-task",
                user_id="test-user",
                invoke_from=InvokeFrom.SERVICE_API,
                conversation_id="test-conversation",
                app_mode="chat",
                message_id="test-message",
            )
        mocker.patch.object(manager, "publish", wraps=manager.publish)
        return manager

    @pytest.fixture
    def moderation_rule(self) -> ModerationRule:
        return ModerationRule(type="keywords", config={"keywords": "badword"})

    @pytest.fixture
    def output_moderation(
        self, queue_manager: MessageBasedAppQueueManager, moderation_rule: ModerationRule
    ) -> OutputModeration:
        return OutputModeration(
            tenant_id="test_tenant", app_id="test_app", rule=moderation_rule, queue_manager=queue_manager
        )

    def test_should_direct_output(self, output_moderation: OutputModeration) -> None:
        assert output_moderation.should_direct_output() is False
        output_moderation.final_output = "blocked"
        assert output_moderation.should_direct_output() is True

    def test_get_final_output(self, output_moderation: OutputModeration) -> None:
        assert output_moderation.get_final_output() == ""
        output_moderation.final_output = "blocked"
        assert output_moderation.get_final_output() == "blocked"

    def test_append_new_token(self, output_moderation: OutputModeration) -> None:
        with patch.object(OutputModeration, "start_thread") as mock_start:
            output_moderation.append_new_token("hello")
            assert output_moderation.buffer == "hello"
            mock_start.assert_called_once()

            output_moderation.thread = MagicMock()
            output_moderation.append_new_token(" world")
            assert output_moderation.buffer == "hello world"
            assert mock_start.call_count == 1

    def test_moderation_completion_no_flag(self, output_moderation: OutputModeration) -> None:
        with patch.object(OutputModeration, "moderation") as mock_moderation:
            mock_moderation.return_value = ModerationOutputsResult(flagged=False, action=ModerationAction.DIRECT_OUTPUT)

            output, flagged = output_moderation.moderation_completion("safe content")

            assert output == "safe content"
            assert flagged is False
            assert output_moderation.is_final_chunk is True

    def test_moderation_completion_flagged_direct_output(
        self, output_moderation: OutputModeration, queue_manager: MessageBasedAppQueueManager
    ) -> None:
        with patch.object(OutputModeration, "moderation") as mock_moderation:
            mock_moderation.return_value = ModerationOutputsResult(
                flagged=True, action=ModerationAction.DIRECT_OUTPUT, preset_response="preset"
            )

            output, flagged = output_moderation.moderation_completion("badword content", public_event=True)

            assert output == "preset"
            assert flagged is True
            _publish_mock(queue_manager).assert_called_once()
            args, _ = _publish_mock(queue_manager).call_args
            assert isinstance(args[0], QueueMessageReplaceEvent)
            assert args[0].text == "preset"
            assert args[1] == PublishFrom.TASK_PIPELINE

    def test_moderation_completion_flagged_overridden(
        self, output_moderation: OutputModeration, queue_manager: MessageBasedAppQueueManager
    ) -> None:
        with patch.object(OutputModeration, "moderation") as mock_moderation:
            mock_moderation.return_value = ModerationOutputsResult(
                flagged=True, action=ModerationAction.OVERRIDDEN, text="masked content"
            )

            output, flagged = output_moderation.moderation_completion("badword content", public_event=True)

            assert output == "masked content"
            assert flagged is True
            _publish_mock(queue_manager).assert_called_once()
            args, _ = _publish_mock(queue_manager).call_args
            assert args[0].text == "masked content"

    def test_start_thread(self, output_moderation: OutputModeration) -> None:
        app = Flask(__name__)
        with app.app_context():
            with patch("threading.Thread") as mock_thread_class:
                mock_thread_instance = MagicMock()
                mock_thread_class.return_value = mock_thread_instance

                thread = output_moderation.start_thread()

                assert thread == mock_thread_instance
                mock_thread_class.assert_called_once()
                mock_thread_instance.start.assert_called_once()

    def test_stop_thread(self, output_moderation: OutputModeration) -> None:
        mock_thread = MagicMock()
        mock_thread.is_alive.return_value = True
        output_moderation.thread = mock_thread

        output_moderation.stop_thread()
        assert output_moderation.thread_running is False

        output_moderation.thread_running = True
        mock_thread.is_alive.return_value = False
        output_moderation.stop_thread()
        assert output_moderation.thread_running

    @patch("core.moderation.output_moderation.ModerationFactory")
    def test_moderation_success(self, mock_factory_class: MagicMock, output_moderation: OutputModeration) -> None:
        mock_factory = mock_factory_class.return_value
        mock_result = ModerationOutputsResult(flagged=False, action=ModerationAction.DIRECT_OUTPUT)
        mock_factory.moderation_for_outputs.return_value = mock_result

        result = output_moderation.moderation("tenant", "app", "buffer")

        assert result == mock_result
        mock_factory_class.assert_called_once_with(
            name="keywords", app_id="app", tenant_id="tenant", config={"keywords": "badword"}
        )

    @patch("core.moderation.output_moderation.ModerationFactory")
    def test_moderation_exception(self, mock_factory_class: MagicMock, output_moderation: OutputModeration) -> None:
        mock_factory_class.side_effect = Exception("error")

        result = output_moderation.moderation("tenant", "app", "buffer")
        assert result is None

    def test_worker_loop_and_exit(self, output_moderation: OutputModeration) -> None:
        app = Flask(__name__)

        # Test exit on thread_running=False
        output_moderation.thread_running = False
        output_moderation.worker(app, 10)
        # Should exit immediately

    def test_worker_no_flag(self, output_moderation: OutputModeration) -> None:
        app = Flask(__name__)

        with patch.object(OutputModeration, "moderation") as mock_moderation:
            mock_moderation.return_value = ModerationOutputsResult(flagged=False, action=ModerationAction.DIRECT_OUTPUT)

            output_moderation.buffer = "safe"
            output_moderation.is_final_chunk = True

            # To avoid infinite loop, we'll set thread_running to False after one iteration
            def side_effect(*_args: object, **_kwargs: object) -> object:
                output_moderation.thread_running = False
                return mock_moderation.return_value

            mock_moderation.side_effect = side_effect

            output_moderation.worker(app, 10)

            assert mock_moderation.called

    def test_worker_flagged_direct_output(
        self, output_moderation: OutputModeration, queue_manager: MessageBasedAppQueueManager
    ) -> None:
        app = Flask(__name__)

        with patch.object(OutputModeration, "moderation") as mock_moderation:
            mock_moderation.return_value = ModerationOutputsResult(
                flagged=True, action=ModerationAction.DIRECT_OUTPUT, preset_response="preset"
            )

            output_moderation.buffer = "badword"
            output_moderation.is_final_chunk = True

            output_moderation.worker(app, 10)

            assert output_moderation.final_output == "preset"
            _publish_mock(queue_manager).assert_called_once()
            # It breaks on DIRECT_OUTPUT

    def test_worker_flagged_overridden(
        self, output_moderation: OutputModeration, queue_manager: MessageBasedAppQueueManager
    ) -> None:
        app = Flask(__name__)

        with patch.object(OutputModeration, "moderation") as mock_moderation:
            # Use side_effect to change thread_running on second call
            def side_effect(*_args: object, **_kwargs: object) -> object:
                if mock_moderation.call_count > 1:
                    output_moderation.thread_running = False
                    return None
                return ModerationOutputsResult(flagged=True, action=ModerationAction.OVERRIDDEN, text="masked")

            mock_moderation.side_effect = side_effect

            output_moderation.buffer = "badword"
            output_moderation.is_final_chunk = True

            output_moderation.worker(app, 10)

            _publish_mock(queue_manager).assert_called_once()
            args, _ = _publish_mock(queue_manager).call_args
            assert args[0].text == "masked"

    def test_worker_chunk_too_small(self, output_moderation: OutputModeration) -> None:
        app = Flask(__name__)
        with patch("time.sleep") as mock_sleep:
            # chunk_length < buffer_size and not is_final_chunk
            output_moderation.buffer = "123"  # length 3
            output_moderation.is_final_chunk = False

            def sleep_side_effect(_seconds: float) -> None:
                output_moderation.thread_running = False

            mock_sleep.side_effect = sleep_side_effect

            output_moderation.worker(app, 10)  # buffer_size 10

            mock_sleep.assert_called_once_with(1)

    def test_worker_empty_not_flagged(
        self, output_moderation: OutputModeration, queue_manager: MessageBasedAppQueueManager
    ) -> None:
        app = Flask(__name__)
        with patch.object(OutputModeration, "moderation") as mock_moderation:
            # Return None (exception or no rule)
            mock_moderation.return_value = None

            def side_effect(*_args: object, **_kwargs: object) -> object:
                output_moderation.thread_running = False

            mock_moderation.side_effect = side_effect

            output_moderation.buffer = "something"
            output_moderation.is_final_chunk = True

            output_moderation.worker(app, 10)

            _publish_mock(queue_manager).assert_not_called()


def _blocking_chunk(text: str) -> MessageStreamResponse:
    return MessageStreamResponse(task_id="task", id="message", answer=text)


class TestBlockingOutputModeration:
    @pytest.fixture
    def handler(self, config_overrides: Callable[..., None], monkeypatch: pytest.MonkeyPatch) -> OutputModeration:
        config_overrides(MODERATION_OUTPUT_MODE="blocking", MODERATION_BUFFER_SIZE=3)
        monkeypatch.setattr(
            Extension,
            "_Extension__module_extensions",
            {"moderation": {"keywords": ModuleExtension(name="keywords", extension_class=KeywordsModeration)}},
        )
        return OutputModeration(
            tenant_id="tenant",
            app_id="app",
            app_mode=AppMode.CHAT,
            rule=ModerationRule(
                type="keywords",
                config={"keywords": "badword", "outputs_config": {"enabled": True, "preset_response": "blocked"}},
            ),
            queue_manager=create_autospec(AppQueueManager, instance=True),
        )

    def test_default_mode_is_async(self, monkeypatch: pytest.MonkeyPatch) -> None:
        monkeypatch.delenv("MODERATION_OUTPUT_MODE", raising=False)
        assert ModerationConfig().MODERATION_OUTPUT_MODE == "async"

    @pytest.mark.parametrize("app_mode", [*AppMode, None])
    def test_blocking_only_supports_text_app_modes(self, handler: OutputModeration, app_mode: AppMode | None) -> None:
        candidate = handler.model_copy(update={"app_mode": app_mode})
        assert candidate.is_blocking is (app_mode in (AppMode.CHAT, AppMode.COMPLETION, AppMode.ADVANCED_CHAT))

    def test_output_disabled_does_not_enable_blocking(self, handler: OutputModeration) -> None:
        handler.rule.config["outputs_config"]["enabled"] = False
        assert handler.is_blocking is False

    def test_async_setting_disables_blocking(
        self, handler: OutputModeration, config_overrides: Callable[..., None]
    ) -> None:
        config_overrides(MODERATION_OUTPUT_MODE="async")
        assert handler.is_blocking is False

    def test_order_cumulative_review_and_final_remainder(
        self, handler: OutputModeration, mocker: MockerFixture
    ) -> None:
        provider = mocker.spy(KeywordsModeration, "moderation_for_outputs")
        first, second, last = (_blocking_chunk(text) for text in ("ab", "c", "d"))
        assert handler.moderate_stream(first) == []
        assert handler.moderate_stream(second) == [first, second]
        assert provider.call_args.args[1] == "abc"
        assert handler.moderate_stream(last) == []
        assert handler.finish_blocking(_blocking_chunk("abcd")) == [last]
        assert provider.call_args.args[1] == "abcd"
        assert handler.released_text == "abcd"
        assert handler.thread is None

    @pytest.mark.parametrize("preset", ["blocked", ""])
    def test_direct_output_suppresses_current_and_future_original(self, handler: OutputModeration, preset: str) -> None:
        handler.rule.config["outputs_config"]["preset_response"] = preset
        result = handler.moderate_stream(_blocking_chunk("badword"))
        assert len(result) == 1
        assert isinstance(result[0], MessageReplaceStreamResponse)
        assert result[0].answer == preset
        assert handler.moderate_stream(_blocking_chunk("later")) == []
        assert handler.finish_blocking(_blocking_chunk("badwordlater")) == []
        assert handler.released_text == preset

    def test_override_continues_from_rewritten_prefix(
        self, handler: OutputModeration, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        real_review = KeywordsModeration.moderation_for_outputs
        audited: list[str] = []

        def redact(provider: KeywordsModeration, text: str) -> ModerationOutputsResult:
            audited.append(text)
            result = real_review(provider, text)
            if result.flagged:
                result.action = ModerationAction.OVERRIDDEN
                result.text = text.replace("badword", "*******")
            return result

        monkeypatch.setattr(KeywordsModeration, "moderation_for_outputs", redact)
        first = handler.moderate_stream(_blocking_chunk("badword"))
        assert len(first) == 1
        assert isinstance(first[0], MessageReplaceStreamResponse)
        assert first[0].answer == "*******"
        assert handler.buffer == "*******"
        tail = _blocking_chunk("tail")
        assert handler.moderate_stream(tail) == [tail]
        assert handler.finish_blocking(_blocking_chunk("badwordtail")) == []
        assert handler.released_text == "*******tail"
        assert audited == ["badword", "*******tail", "*******tail"]

    def test_empty_override_does_not_restore_original_at_finish(
        self, handler: OutputModeration, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        real_review = KeywordsModeration.moderation_for_outputs
        audited: list[str] = []

        def redact(provider: KeywordsModeration, text: str) -> ModerationOutputsResult:
            audited.append(text)
            result = real_review(provider, text)
            if result.flagged:
                result.action = ModerationAction.OVERRIDDEN
                result.text = ""
            return result

        monkeypatch.setattr(KeywordsModeration, "moderation_for_outputs", redact)
        handler.moderate_stream(_blocking_chunk("badword"))
        assert handler.finish_blocking(_blocking_chunk("badword")) == []
        assert handler.released_text == ""
        assert audited == ["badword", ""]

    def test_later_context_can_invalidate_an_already_released_prefix(self, handler: OutputModeration) -> None:
        first = _blocking_chunk("bad")
        assert handler.moderate_stream(first) == [first]
        result = handler.moderate_stream(_blocking_chunk("word"))
        assert len(result) == 1
        assert isinstance(result[0], MessageReplaceStreamResponse)
        assert result[0].answer == "blocked"
        assert handler.moderate_stream(_blocking_chunk("after")) == []

    def test_provider_failure_retains_pending_and_final_failure_drops_it(
        self, handler: OutputModeration, mocker: MockerFixture, caplog: pytest.LogCaptureFixture
    ) -> None:
        provider = mocker.patch.object(
            KeywordsModeration, "moderation_for_outputs", autospec=True, side_effect=RuntimeError("down")
        )
        assert handler.moderate_stream(_blocking_chunk("abc")) == []
        assert handler.finish_blocking(_blocking_chunk("abc")) == []
        assert handler.released_text == ""
        assert handler.pending_responses == []
        assert "WARNING" in caplog.text
        assert provider.call_count == 2

    def test_failed_chunk_can_be_released_after_successful_final_review(
        self, handler: OutputModeration, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        real_review = KeywordsModeration.moderation_for_outputs
        calls = 0

        def transient_review(provider: KeywordsModeration, text: str) -> ModerationOutputsResult:
            nonlocal calls
            calls += 1
            if calls == 1:
                raise RuntimeError("down")
            return real_review(provider, text)

        monkeypatch.setattr(KeywordsModeration, "moderation_for_outputs", transient_review)
        pending = _blocking_chunk("abc")
        assert handler.moderate_stream(pending) == []
        assert handler.finish_blocking(_blocking_chunk("abc")) == [pending]

    def test_final_review_even_without_remainder(self, handler: OutputModeration) -> None:
        handler.moderate_stream(_blocking_chunk("abc"))
        handler.rule.config["keywords"] = "abc"
        handler.rule.config["outputs_config"]["preset_response"] = ""
        result = handler.finish_blocking(_blocking_chunk("abc"))
        assert len(result) == 1
        assert isinstance(result[0], MessageReplaceStreamResponse)
        assert result[0].answer == ""
        assert handler.released_text == ""

    def test_nonstreamed_fallback_is_reviewed(self, handler: OutputModeration) -> None:
        answer = _blocking_chunk("safe")
        assert handler.finish_blocking(answer) == [answer]
        assert handler.released_text == "safe"
        assert handler.finish_blocking(answer) == []

    def test_prefilled_answer_is_not_reemitted(self, handler: OutputModeration, mocker: MockerFixture) -> None:
        provider = mocker.spy(KeywordsModeration, "moderation_for_outputs")
        handler.buffer = handler.released_text = "before"
        assert handler.finish_blocking(_blocking_chunk("before")) == []
        assert handler.released_text == "before"
        assert provider.call_args.args[1] == "before"
