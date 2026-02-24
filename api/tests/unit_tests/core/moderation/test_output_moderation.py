from unittest.mock import MagicMock, patch

import pytest
from flask import Flask

from core.app.apps.base_app_queue_manager import AppQueueManager, PublishFrom
from core.app.entities.queue_entities import QueueMessageReplaceEvent
from core.moderation.base import ModerationAction, ModerationOutputsResult
from core.moderation.output_moderation import ModerationRule, OutputModeration


class TestOutputModeration:
    @pytest.fixture
    def mock_queue_manager(self):
        return MagicMock(spec=AppQueueManager)

    @pytest.fixture
    def moderation_rule(self):
        return ModerationRule(type="keywords", config={"keywords": "badword"})

    @pytest.fixture
    def output_moderation(self, mock_queue_manager, moderation_rule):
        return OutputModeration(
            tenant_id="test_tenant", app_id="test_app", rule=moderation_rule, queue_manager=mock_queue_manager
        )

    def test_should_direct_output(self, output_moderation):
        assert output_moderation.should_direct_output() is False
        output_moderation.final_output = "blocked"
        assert output_moderation.should_direct_output() is True

    def test_get_final_output(self, output_moderation):
        assert output_moderation.get_final_output() == ""
        output_moderation.final_output = "blocked"
        assert output_moderation.get_final_output() == "blocked"

    def test_append_new_token(self, output_moderation):
        with patch.object(OutputModeration, "start_thread") as mock_start:
            output_moderation.append_new_token("hello")
            assert output_moderation.buffer == "hello"
            mock_start.assert_called_once()

            output_moderation.thread = MagicMock()
            output_moderation.append_new_token(" world")
            assert output_moderation.buffer == "hello world"
            assert mock_start.call_count == 1

    def test_moderation_completion_no_flag(self, output_moderation):
        with patch.object(OutputModeration, "moderation") as mock_moderation:
            mock_moderation.return_value = ModerationOutputsResult(flagged=False, action=ModerationAction.DIRECT_OUTPUT)

            output, flagged = output_moderation.moderation_completion("safe content")

            assert output == "safe content"
            assert flagged is False
            assert output_moderation.is_final_chunk is True

    def test_moderation_completion_flagged_direct_output(self, output_moderation, mock_queue_manager):
        with patch.object(OutputModeration, "moderation") as mock_moderation:
            mock_moderation.return_value = ModerationOutputsResult(
                flagged=True, action=ModerationAction.DIRECT_OUTPUT, preset_response="preset"
            )

            output, flagged = output_moderation.moderation_completion("badword content", public_event=True)

            assert output == "preset"
            assert flagged is True
            mock_queue_manager.publish.assert_called_once()
            args, _ = mock_queue_manager.publish.call_args
            assert isinstance(args[0], QueueMessageReplaceEvent)
            assert args[0].text == "preset"
            assert args[1] == PublishFrom.TASK_PIPELINE

    def test_moderation_completion_flagged_overridden(self, output_moderation, mock_queue_manager):
        with patch.object(OutputModeration, "moderation") as mock_moderation:
            mock_moderation.return_value = ModerationOutputsResult(
                flagged=True, action=ModerationAction.OVERRIDDEN, text="masked content"
            )

            output, flagged = output_moderation.moderation_completion("badword content", public_event=True)

            assert output == "masked content"
            assert flagged is True
            mock_queue_manager.publish.assert_called_once()
            args, _ = mock_queue_manager.publish.call_args
            assert args[0].text == "masked content"

    def test_start_thread(self, output_moderation):
        mock_app = MagicMock(spec=Flask)
        with patch("core.moderation.output_moderation.current_app") as mock_current_app:
            mock_current_app._get_current_object.return_value = mock_app
            with patch("threading.Thread") as mock_thread_class:
                mock_thread_instance = MagicMock()
                mock_thread_class.return_value = mock_thread_instance

                thread = output_moderation.start_thread()

                assert thread == mock_thread_instance
                mock_thread_class.assert_called_once()
                mock_thread_instance.start.assert_called_once()

    def test_stop_thread(self, output_moderation):
        mock_thread = MagicMock()
        mock_thread.is_alive.return_value = True
        output_moderation.thread = mock_thread

        output_moderation.stop_thread()
        assert output_moderation.thread_running is False

        output_moderation.thread_running = True
        mock_thread.is_alive.return_value = False
        output_moderation.stop_thread()
        assert output_moderation.thread_running is True

    @patch("core.moderation.output_moderation.ModerationFactory")
    def test_moderation_success(self, mock_factory_class, output_moderation):
        mock_factory = mock_factory_class.return_value
        mock_result = ModerationOutputsResult(flagged=False, action=ModerationAction.DIRECT_OUTPUT)
        mock_factory.moderation_for_outputs.return_value = mock_result

        result = output_moderation.moderation("tenant", "app", "buffer")

        assert result == mock_result
        mock_factory_class.assert_called_once_with(
            name="keywords", app_id="app", tenant_id="tenant", config={"keywords": "badword"}
        )

    @patch("core.moderation.output_moderation.ModerationFactory")
    def test_moderation_exception(self, mock_factory_class, output_moderation):
        mock_factory_class.side_effect = Exception("error")

        result = output_moderation.moderation("tenant", "app", "buffer")
        assert result is None

    def test_worker_loop_and_exit(self, output_moderation, mock_queue_manager):
        mock_app = MagicMock(spec=Flask)

        # Test exit on thread_running=False
        output_moderation.thread_running = False
        output_moderation.worker(mock_app, 10)
        # Should exit immediately

    def test_worker_no_flag(self, output_moderation):
        mock_app = MagicMock(spec=Flask)

        with patch.object(OutputModeration, "moderation") as mock_moderation:
            mock_moderation.return_value = ModerationOutputsResult(flagged=False, action=ModerationAction.DIRECT_OUTPUT)

            output_moderation.buffer = "safe"
            output_moderation.is_final_chunk = True

            # To avoid infinite loop, we'll set thread_running to False after one iteration
            def side_effect(*args, **kwargs):
                output_moderation.thread_running = False
                return mock_moderation.return_value

            mock_moderation.side_effect = side_effect

            output_moderation.worker(mock_app, 10)

            assert mock_moderation.called

    def test_worker_flagged_direct_output(self, output_moderation, mock_queue_manager):
        mock_app = MagicMock(spec=Flask)

        with patch.object(OutputModeration, "moderation") as mock_moderation:
            mock_moderation.return_value = ModerationOutputsResult(
                flagged=True, action=ModerationAction.DIRECT_OUTPUT, preset_response="preset"
            )

            output_moderation.buffer = "badword"
            output_moderation.is_final_chunk = True

            output_moderation.worker(mock_app, 10)

            assert output_moderation.final_output == "preset"
            mock_queue_manager.publish.assert_called_once()
            # It breaks on DIRECT_OUTPUT

    def test_worker_flagged_overridden(self, output_moderation, mock_queue_manager):
        mock_app = MagicMock(spec=Flask)

        with patch.object(OutputModeration, "moderation") as mock_moderation:
            # Use side_effect to change thread_running on second call
            def side_effect(*args, **kwargs):
                if mock_moderation.call_count > 1:
                    output_moderation.thread_running = False
                    return None
                return ModerationOutputsResult(flagged=True, action=ModerationAction.OVERRIDDEN, text="masked")

            mock_moderation.side_effect = side_effect

            output_moderation.buffer = "badword"
            output_moderation.is_final_chunk = True

            output_moderation.worker(mock_app, 10)

            mock_queue_manager.publish.assert_called_once()
            args, _ = mock_queue_manager.publish.call_args
            assert args[0].text == "masked"

    def test_worker_chunk_too_small(self, output_moderation):
        mock_app = MagicMock(spec=Flask)
        with patch("time.sleep") as mock_sleep:
            # chunk_length < buffer_size and not is_final_chunk
            output_moderation.buffer = "123"  # length 3
            output_moderation.is_final_chunk = False

            def sleep_side_effect(seconds):
                output_moderation.thread_running = False

            mock_sleep.side_effect = sleep_side_effect

            output_moderation.worker(mock_app, 10)  # buffer_size 10

            mock_sleep.assert_called_once_with(1)

    def test_worker_empty_not_flagged(self, output_moderation, mock_queue_manager):
        mock_app = MagicMock(spec=Flask)
        with patch.object(OutputModeration, "moderation") as mock_moderation:
            # Return None (exception or no rule)
            mock_moderation.return_value = None

            def side_effect(*args, **kwargs):
                output_moderation.thread_running = False

            mock_moderation.side_effect = side_effect

            output_moderation.buffer = "something"
            output_moderation.is_final_chunk = True

            output_moderation.worker(mock_app, 10)

            mock_queue_manager.publish.assert_not_called()
