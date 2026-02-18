"""Tests for Redis command channel implementation."""

import json
from unittest.mock import MagicMock

from core.variables import IntegerVariable, StringVariable
from core.workflow.graph_engine.command_channels.redis_channel import RedisChannel
from core.workflow.graph_engine.entities.commands import (
    AbortCommand,
    CommandType,
    GraphEngineCommand,
    UpdateVariablesCommand,
    VariableUpdate,
)


class TestRedisChannel:
    """Test suite for RedisChannel functionality."""

    def test_init(self):
        """Test RedisChannel initialization."""
        mock_redis = MagicMock()
        channel_key = "test:channel:key"
        ttl = 7200

        channel = RedisChannel(mock_redis, channel_key, ttl)

        assert channel._redis == mock_redis
        assert channel._key == channel_key
        assert channel._command_ttl == ttl

    def test_init_default_ttl(self):
        """Test RedisChannel initialization with default TTL."""
        mock_redis = MagicMock()
        channel_key = "test:channel:key"

        channel = RedisChannel(mock_redis, channel_key)

        assert channel._command_ttl == 3600  # Default TTL

    def test_send_command(self):
        """Test sending a command to Redis."""
        mock_redis = MagicMock()
        mock_pipe = MagicMock()
        context = MagicMock()
        context.__enter__.return_value = mock_pipe
        context.__exit__.return_value = None
        mock_redis.pipeline.return_value = context

        channel = RedisChannel(mock_redis, "test:key", 3600)

        pending_key = "test:key:pending"

        # Create a test command
        command = GraphEngineCommand(command_type=CommandType.ABORT)

        # Send the command
        channel.send_command(command)

        # Verify pipeline was used
        mock_redis.pipeline.assert_called_once()

        # Verify rpush was called with correct data
        expected_json = json.dumps(command.model_dump())
        mock_pipe.rpush.assert_called_once_with("test:key", expected_json)

        # Verify expire was set
        mock_pipe.expire.assert_called_once_with("test:key", 3600)
        mock_pipe.set.assert_called_once_with(pending_key, "1", ex=3600)

        # Verify execute was called
        mock_pipe.execute.assert_called_once()

    def test_fetch_commands_empty(self):
        """Test fetching commands when Redis list is empty."""
        mock_redis = MagicMock()
        pending_pipe = MagicMock()
        fetch_pipe = MagicMock()
        pending_context = MagicMock()
        fetch_context = MagicMock()
        pending_context.__enter__.return_value = pending_pipe
        pending_context.__exit__.return_value = None
        fetch_context.__enter__.return_value = fetch_pipe
        fetch_context.__exit__.return_value = None
        mock_redis.pipeline.side_effect = [pending_context]

        # No pending marker
        pending_pipe.execute.return_value = [None, 0]
        mock_redis.llen.return_value = 0

        channel = RedisChannel(mock_redis, "test:key")
        commands = channel.fetch_commands()

        assert commands == []
        mock_redis.pipeline.assert_called_once()
        fetch_pipe.lrange.assert_not_called()
        fetch_pipe.delete.assert_not_called()

    def test_fetch_commands_with_abort_command(self):
        """Test fetching abort commands from Redis."""
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

        # Create abort command data
        abort_command = AbortCommand()
        command_json = json.dumps(abort_command.model_dump())

        # Simulate Redis returning one command
        pending_pipe.execute.return_value = [b"1", 1]
        fetch_pipe.execute.return_value = [[command_json.encode()], 1]

        channel = RedisChannel(mock_redis, "test:key")
        commands = channel.fetch_commands()

        assert len(commands) == 1
        assert isinstance(commands[0], AbortCommand)
        assert commands[0].command_type == CommandType.ABORT

    def test_fetch_commands_multiple(self):
        """Test fetching multiple commands from Redis."""
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

        # Create multiple commands
        command1 = GraphEngineCommand(command_type=CommandType.ABORT)
        command2 = AbortCommand()

        command1_json = json.dumps(command1.model_dump())
        command2_json = json.dumps(command2.model_dump())

        # Simulate Redis returning multiple commands
        pending_pipe.execute.return_value = [b"1", 1]
        fetch_pipe.execute.return_value = [[command1_json.encode(), command2_json.encode()], 1]

        channel = RedisChannel(mock_redis, "test:key")
        commands = channel.fetch_commands()

        assert len(commands) == 2
        assert commands[0].command_type == CommandType.ABORT
        assert isinstance(commands[1], AbortCommand)

    def test_fetch_commands_with_update_variables_command(self):
        """Test fetching update variables command from Redis."""
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

        update_command = UpdateVariablesCommand(
            updates=[
                VariableUpdate(
                    value=StringVariable(name="foo", value="bar", selector=["node1", "foo"]),
                ),
                VariableUpdate(
                    value=IntegerVariable(name="baz", value=123, selector=["node2", "baz"]),
                ),
            ]
        )
        command_json = json.dumps(update_command.model_dump())

        pending_pipe.execute.return_value = [b"1", 1]
        fetch_pipe.execute.return_value = [[command_json.encode()], 1]

        channel = RedisChannel(mock_redis, "test:key")
        commands = channel.fetch_commands()

        assert len(commands) == 1
        assert isinstance(commands[0], UpdateVariablesCommand)
        assert isinstance(commands[0].updates[0].value, StringVariable)
        assert list(commands[0].updates[0].value.selector) == ["node1", "foo"]
        assert commands[0].updates[0].value.value == "bar"

    def test_fetch_commands_skips_invalid_json(self):
        """Test that invalid JSON commands are skipped."""
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

        # Mix valid and invalid JSON
        valid_command = AbortCommand()
        valid_json = json.dumps(valid_command.model_dump())
        invalid_json = b"invalid json {"

        # Simulate Redis returning mixed valid/invalid commands
        pending_pipe.execute.return_value = [b"1", 1]
        fetch_pipe.execute.return_value = [[invalid_json, valid_json.encode()], 1]

        channel = RedisChannel(mock_redis, "test:key")
        commands = channel.fetch_commands()

        # Should only return the valid command
        assert len(commands) == 1
        assert isinstance(commands[0], AbortCommand)

    def test_deserialize_command_abort(self):
        """Test deserializing an abort command."""
        channel = RedisChannel(MagicMock(), "test:key")

        abort_data = {"command_type": CommandType.ABORT}
        command = channel._deserialize_command(abort_data)

        assert isinstance(command, AbortCommand)
        assert command.command_type == CommandType.ABORT

    def test_deserialize_command_generic(self):
        """Test deserializing a generic command."""
        channel = RedisChannel(MagicMock(), "test:key")

        # For now, only ABORT is supported, but test generic handling
        generic_data = {"command_type": CommandType.ABORT}
        command = channel._deserialize_command(generic_data)

        assert command is not None
        assert command.command_type == CommandType.ABORT

    def test_deserialize_command_invalid(self):
        """Test deserializing invalid command data."""
        channel = RedisChannel(MagicMock(), "test:key")

        # Missing command_type
        invalid_data = {"some_field": "value"}
        command = channel._deserialize_command(invalid_data)

        assert command is None

    def test_deserialize_command_invalid_type(self):
        """Test deserializing command with invalid type."""
        channel = RedisChannel(MagicMock(), "test:key")

        # Invalid command type
        invalid_data = {"command_type": "INVALID_TYPE"}
        command = channel._deserialize_command(invalid_data)

        assert command is None

    def test_atomic_fetch_and_clear(self):
        """Test that fetch_commands atomically fetches and clears the list."""
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

        command = AbortCommand()
        command_json = json.dumps(command.model_dump())
        pending_pipe.execute.return_value = [b"1", 1]
        fetch_pipe.execute.return_value = [[command_json.encode()], 1]

        channel = RedisChannel(mock_redis, "test:key")

        # First fetch should return the command
        commands = channel.fetch_commands()
        assert len(commands) == 1

        # Verify both lrange and delete were called in the pipeline
        assert fetch_pipe.lrange.call_count == 1
        assert fetch_pipe.delete.call_count == 1
        fetch_pipe.lrange.assert_called_with("test:key", 0, -1)
        fetch_pipe.delete.assert_called_with("test:key")

    def test_fetch_commands_without_pending_marker_returns_empty(self):
        """Ensure we avoid unnecessary list reads when pending flag is missing."""
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

        # Pending flag absent
        pending_pipe.execute.return_value = [None, 0]
        channel = RedisChannel(mock_redis, "test:key")
        commands = channel.fetch_commands()

        assert commands == []
        mock_redis.llen.assert_not_called()
        assert mock_redis.pipeline.call_count == 1
