"""Tests for Redis command channel implementation."""

import json
from unittest.mock import MagicMock

from core.workflow.graph_engine.command_channels.redis_channel import RedisChannel
from core.workflow.graph_engine.entities.commands import AbortCommand, CommandType, GraphEngineCommand


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
        mock_redis.pipeline.return_value.__enter__ = MagicMock(return_value=mock_pipe)
        mock_redis.pipeline.return_value.__exit__ = MagicMock(return_value=None)

        channel = RedisChannel(mock_redis, "test:key", 3600)

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

        # Verify execute was called
        mock_pipe.execute.assert_called_once()

    def test_fetch_commands_empty(self):
        """Test fetching commands when Redis list is empty."""
        mock_redis = MagicMock()
        mock_pipe = MagicMock()
        mock_redis.pipeline.return_value.__enter__ = MagicMock(return_value=mock_pipe)
        mock_redis.pipeline.return_value.__exit__ = MagicMock(return_value=None)

        # Simulate empty list
        mock_pipe.execute.return_value = [[], 1]  # Empty list, delete successful

        channel = RedisChannel(mock_redis, "test:key")
        commands = channel.fetch_commands()

        assert commands == []
        mock_pipe.lrange.assert_called_once_with("test:key", 0, -1)
        mock_pipe.delete.assert_called_once_with("test:key")

    def test_fetch_commands_with_abort_command(self):
        """Test fetching abort commands from Redis."""
        mock_redis = MagicMock()
        mock_pipe = MagicMock()
        mock_redis.pipeline.return_value.__enter__ = MagicMock(return_value=mock_pipe)
        mock_redis.pipeline.return_value.__exit__ = MagicMock(return_value=None)

        # Create abort command data
        abort_command = AbortCommand()
        command_json = json.dumps(abort_command.model_dump())

        # Simulate Redis returning one command
        mock_pipe.execute.return_value = [[command_json.encode()], 1]

        channel = RedisChannel(mock_redis, "test:key")
        commands = channel.fetch_commands()

        assert len(commands) == 1
        assert isinstance(commands[0], AbortCommand)
        assert commands[0].command_type == CommandType.ABORT

    def test_fetch_commands_multiple(self):
        """Test fetching multiple commands from Redis."""
        mock_redis = MagicMock()
        mock_pipe = MagicMock()
        mock_redis.pipeline.return_value.__enter__ = MagicMock(return_value=mock_pipe)
        mock_redis.pipeline.return_value.__exit__ = MagicMock(return_value=None)

        # Create multiple commands
        command1 = GraphEngineCommand(command_type=CommandType.ABORT)
        command2 = AbortCommand()

        command1_json = json.dumps(command1.model_dump())
        command2_json = json.dumps(command2.model_dump())

        # Simulate Redis returning multiple commands
        mock_pipe.execute.return_value = [[command1_json.encode(), command2_json.encode()], 1]

        channel = RedisChannel(mock_redis, "test:key")
        commands = channel.fetch_commands()

        assert len(commands) == 2
        assert commands[0].command_type == CommandType.ABORT
        assert isinstance(commands[1], AbortCommand)

    def test_fetch_commands_skips_invalid_json(self):
        """Test that invalid JSON commands are skipped."""
        mock_redis = MagicMock()
        mock_pipe = MagicMock()
        mock_redis.pipeline.return_value.__enter__ = MagicMock(return_value=mock_pipe)
        mock_redis.pipeline.return_value.__exit__ = MagicMock(return_value=None)

        # Mix valid and invalid JSON
        valid_command = AbortCommand()
        valid_json = json.dumps(valid_command.model_dump())
        invalid_json = b"invalid json {"

        # Simulate Redis returning mixed valid/invalid commands
        mock_pipe.execute.return_value = [[invalid_json, valid_json.encode()], 1]

        channel = RedisChannel(mock_redis, "test:key")
        commands = channel.fetch_commands()

        # Should only return the valid command
        assert len(commands) == 1
        assert isinstance(commands[0], AbortCommand)

    def test_deserialize_command_abort(self):
        """Test deserializing an abort command."""
        channel = RedisChannel(MagicMock(), "test:key")

        abort_data = {"command_type": CommandType.ABORT.value}
        command = channel._deserialize_command(abort_data)

        assert isinstance(command, AbortCommand)
        assert command.command_type == CommandType.ABORT

    def test_deserialize_command_generic(self):
        """Test deserializing a generic command."""
        channel = RedisChannel(MagicMock(), "test:key")

        # For now, only ABORT is supported, but test generic handling
        generic_data = {"command_type": CommandType.ABORT.value}
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
        mock_pipe = MagicMock()
        mock_redis.pipeline.return_value.__enter__ = MagicMock(return_value=mock_pipe)
        mock_redis.pipeline.return_value.__exit__ = MagicMock(return_value=None)

        command = AbortCommand()
        command_json = json.dumps(command.model_dump())
        mock_pipe.execute.return_value = [[command_json.encode()], 1]

        channel = RedisChannel(mock_redis, "test:key")

        # First fetch should return the command
        commands = channel.fetch_commands()
        assert len(commands) == 1

        # Verify both lrange and delete were called in the pipeline
        assert mock_pipe.lrange.call_count == 1
        assert mock_pipe.delete.call_count == 1
        mock_pipe.lrange.assert_called_with("test:key", 0, -1)
        mock_pipe.delete.assert_called_with("test:key")
