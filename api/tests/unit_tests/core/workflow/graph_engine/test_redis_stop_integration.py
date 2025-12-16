"""
Unit tests for Redis-based stop functionality in GraphEngine.

Tests the integration of Redis command channel for stopping workflows
without user permission checks.
"""

import json
from unittest.mock import MagicMock, Mock, patch

import pytest
import redis

from core.app.apps.base_app_queue_manager import AppQueueManager
from core.workflow.graph_engine.command_channels.redis_channel import RedisChannel
from core.workflow.graph_engine.entities.commands import AbortCommand, CommandType, PauseCommand
from core.workflow.graph_engine.manager import GraphEngineManager


class TestRedisStopIntegration:
    """Test suite for Redis-based workflow stop functionality."""

    def test_graph_engine_manager_sends_abort_command(self):
        """Test that GraphEngineManager correctly sends abort command through Redis."""
        # Setup
        task_id = "test-task-123"
        expected_channel_key = f"workflow:{task_id}:commands"

        # Mock redis client
        mock_redis = MagicMock()
        mock_pipeline = MagicMock()
        mock_redis.pipeline.return_value.__enter__ = Mock(return_value=mock_pipeline)
        mock_redis.pipeline.return_value.__exit__ = Mock(return_value=None)

        with patch("core.workflow.graph_engine.manager.redis_client", mock_redis):
            # Execute
            GraphEngineManager.send_stop_command(task_id, reason="Test stop")

            # Verify
            mock_redis.pipeline.assert_called_once()

            # Check that rpush was called with correct arguments
            calls = mock_pipeline.rpush.call_args_list
            assert len(calls) == 1

            # Verify the channel key
            assert calls[0][0][0] == expected_channel_key

            # Verify the command data
            command_json = calls[0][0][1]
            command_data = json.loads(command_json)
            assert command_data["command_type"] == CommandType.ABORT
            assert command_data["reason"] == "Test stop"

    def test_graph_engine_manager_sends_pause_command(self):
        """Test that GraphEngineManager correctly sends pause command through Redis."""
        task_id = "test-task-pause-123"
        expected_channel_key = f"workflow:{task_id}:commands"

        mock_redis = MagicMock()
        mock_pipeline = MagicMock()
        mock_redis.pipeline.return_value.__enter__ = Mock(return_value=mock_pipeline)
        mock_redis.pipeline.return_value.__exit__ = Mock(return_value=None)

        with patch("core.workflow.graph_engine.manager.redis_client", mock_redis):
            GraphEngineManager.send_pause_command(task_id, reason="Awaiting resources")

            mock_redis.pipeline.assert_called_once()
            calls = mock_pipeline.rpush.call_args_list
            assert len(calls) == 1
            assert calls[0][0][0] == expected_channel_key

            command_json = calls[0][0][1]
            command_data = json.loads(command_json)
            assert command_data["command_type"] == CommandType.PAUSE.value
            assert command_data["reason"] == "Awaiting resources"

    def test_graph_engine_manager_handles_redis_failure_gracefully(self):
        """Test that GraphEngineManager handles Redis failures without raising exceptions."""
        task_id = "test-task-456"

        # Mock redis client to raise exception
        mock_redis = MagicMock()
        mock_redis.pipeline.side_effect = redis.ConnectionError("Redis connection failed")

        with patch("core.workflow.graph_engine.manager.redis_client", mock_redis):
            # Should not raise exception
            try:
                GraphEngineManager.send_stop_command(task_id)
            except Exception as e:
                pytest.fail(f"GraphEngineManager.send_stop_command raised {e} unexpectedly")

    def test_app_queue_manager_no_user_check(self):
        """Test that AppQueueManager.set_stop_flag_no_user_check works without user validation."""
        task_id = "test-task-789"
        expected_cache_key = f"generate_task_stopped:{task_id}"

        # Mock redis client
        mock_redis = MagicMock()

        with patch("core.app.apps.base_app_queue_manager.redis_client", mock_redis):
            # Execute
            AppQueueManager.set_stop_flag_no_user_check(task_id)

            # Verify
            mock_redis.setex.assert_called_once_with(expected_cache_key, 600, 1)

    def test_app_queue_manager_no_user_check_with_empty_task_id(self):
        """Test that AppQueueManager.set_stop_flag_no_user_check handles empty task_id."""
        # Mock redis client
        mock_redis = MagicMock()

        with patch("core.app.apps.base_app_queue_manager.redis_client", mock_redis):
            # Execute with empty task_id
            AppQueueManager.set_stop_flag_no_user_check("")

            # Verify redis was not called
            mock_redis.setex.assert_not_called()

    def test_redis_channel_send_abort_command(self):
        """Test RedisChannel correctly serializes and sends AbortCommand."""
        # Setup
        mock_redis = MagicMock()
        mock_pipeline = MagicMock()
        mock_redis.pipeline.return_value.__enter__ = Mock(return_value=mock_pipeline)
        mock_redis.pipeline.return_value.__exit__ = Mock(return_value=None)

        channel_key = "workflow:test:commands"
        channel = RedisChannel(mock_redis, channel_key)

        # Create commands
        abort_command = AbortCommand(reason="User requested stop")
        pause_command = PauseCommand(reason="User requested pause")

        # Execute
        channel.send_command(abort_command)
        channel.send_command(pause_command)

        # Verify
        mock_redis.pipeline.assert_called()

        # Check rpush was called
        calls = mock_pipeline.rpush.call_args_list
        assert len(calls) == 2
        assert calls[0][0][0] == channel_key
        assert calls[1][0][0] == channel_key

        # Verify serialized commands
        abort_command_json = calls[0][0][1]
        abort_command_data = json.loads(abort_command_json)
        assert abort_command_data["command_type"] == CommandType.ABORT.value
        assert abort_command_data["reason"] == "User requested stop"

        pause_command_json = calls[1][0][1]
        pause_command_data = json.loads(pause_command_json)
        assert pause_command_data["command_type"] == CommandType.PAUSE.value
        assert pause_command_data["reason"] == "User requested pause"

        # Check expire was set for each
        assert mock_pipeline.expire.call_count == 2
        mock_pipeline.expire.assert_any_call(channel_key, 3600)

    def test_redis_channel_fetch_commands(self):
        """Test RedisChannel correctly fetches and deserializes commands."""
        # Setup
        mock_redis = MagicMock()
        pending_pipe = MagicMock()
        fetch_pipe = MagicMock()
        pending_context = MagicMock()
        fetch_context = MagicMock()
        pending_context.__enter__.return_value = pending_pipe
        pending_context.__exit__.return_value = None
        fetch_context.__enter__.return_value = fetch_pipe
        fetch_context.__exit__.return_value = None
        mock_redis.pipeline.side_effect = [pending_context, fetch_context]

        # Mock command data
        abort_command_json = json.dumps(
            {"command_type": CommandType.ABORT.value, "reason": "Test abort", "payload": None}
        )
        pause_command_json = json.dumps(
            {"command_type": CommandType.PAUSE.value, "reason": "Pause requested", "payload": None}
        )

        # Mock pipeline execute to return commands
        pending_pipe.execute.return_value = [b"1", 1]
        fetch_pipe.execute.return_value = [
            [abort_command_json.encode(), pause_command_json.encode()],  # lrange result
            True,  # delete result
        ]

        channel_key = "workflow:test:commands"
        channel = RedisChannel(mock_redis, channel_key)

        # Execute
        commands = channel.fetch_commands()

        # Verify
        assert len(commands) == 2
        assert isinstance(commands[0], AbortCommand)
        assert commands[0].command_type == CommandType.ABORT
        assert commands[0].reason == "Test abort"
        assert isinstance(commands[1], PauseCommand)
        assert commands[1].command_type == CommandType.PAUSE
        assert commands[1].reason == "Pause requested"

        # Verify Redis operations
        pending_pipe.get.assert_called_once_with(f"{channel_key}:pending")
        pending_pipe.delete.assert_called_once_with(f"{channel_key}:pending")
        fetch_pipe.lrange.assert_called_once_with(channel_key, 0, -1)
        fetch_pipe.delete.assert_called_once_with(channel_key)
        assert mock_redis.pipeline.call_count == 2

    def test_redis_channel_fetch_commands_handles_invalid_json(self):
        """Test RedisChannel gracefully handles invalid JSON in commands."""
        # Setup
        mock_redis = MagicMock()
        pending_pipe = MagicMock()
        fetch_pipe = MagicMock()
        pending_context = MagicMock()
        fetch_context = MagicMock()
        pending_context.__enter__.return_value = pending_pipe
        pending_context.__exit__.return_value = None
        fetch_context.__enter__.return_value = fetch_pipe
        fetch_context.__exit__.return_value = None
        mock_redis.pipeline.side_effect = [pending_context, fetch_context]

        # Mock invalid command data
        pending_pipe.execute.return_value = [b"1", 1]
        fetch_pipe.execute.return_value = [
            [b"invalid json", b'{"command_type": "invalid_type"}'],  # lrange result
            True,  # delete result
        ]

        channel_key = "workflow:test:commands"
        channel = RedisChannel(mock_redis, channel_key)

        # Execute
        commands = channel.fetch_commands()

        # Should return empty list due to invalid commands
        assert len(commands) == 0

    def test_dual_stop_mechanism_compatibility(self):
        """Test that both stop mechanisms can work together."""
        task_id = "test-task-dual"

        # Mock redis client
        mock_redis = MagicMock()
        mock_pipeline = MagicMock()
        mock_redis.pipeline.return_value.__enter__ = Mock(return_value=mock_pipeline)
        mock_redis.pipeline.return_value.__exit__ = Mock(return_value=None)

        with (
            patch("core.app.apps.base_app_queue_manager.redis_client", mock_redis),
            patch("core.workflow.graph_engine.manager.redis_client", mock_redis),
        ):
            # Execute both stop mechanisms
            AppQueueManager.set_stop_flag_no_user_check(task_id)
            GraphEngineManager.send_stop_command(task_id)

            # Verify legacy stop flag was set
            expected_stop_flag_key = f"generate_task_stopped:{task_id}"
            mock_redis.setex.assert_called_once_with(expected_stop_flag_key, 600, 1)

            # Verify command was sent through Redis channel
            mock_redis.pipeline.assert_called()
            calls = mock_pipeline.rpush.call_args_list
            assert len(calls) == 1
            assert calls[0][0][0] == f"workflow:{task_id}:commands"
