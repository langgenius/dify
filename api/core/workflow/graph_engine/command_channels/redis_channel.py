"""
Redis-based implementation of CommandChannel for distributed scenarios.

This implementation uses Redis lists for command queuing, supporting
multi-instance deployments and cross-server communication.
Each instance uses a unique key for its command queue.
"""

import json
from typing import Any, Optional

from ..entities.commands import AbortCommand, CommandType, GraphEngineCommand


class RedisChannel:
    """
    Redis-based command channel implementation for distributed systems.

    Each instance uses a unique Redis key for its command queue.
    Commands are JSON-serialized for transport.
    """

    def __init__(
        self,
        redis_client: Any,  # Accepts both redis.Redis and RedisClientWrapper
        channel_key: str,
        command_ttl: int = 3600,
    ) -> None:
        """
        Initialize the Redis channel.

        Args:
            redis_client: Redis client instance
            channel_key: Unique key for this channel's command queue
            command_ttl: TTL for command keys in seconds (default: 3600)
        """
        self._redis = redis_client
        self._key = channel_key
        self._command_ttl = command_ttl

    def fetch_commands(self) -> list[GraphEngineCommand]:
        """
        Fetch all pending commands from Redis.

        Returns:
            List of pending commands (drains the Redis list)
        """
        commands: list[GraphEngineCommand] = []

        # Use pipeline for atomic operations
        with self._redis.pipeline() as pipe:
            # Get all commands and clear the list atomically
            pipe.lrange(self._key, 0, -1)
            pipe.delete(self._key)
            results = pipe.execute()

        # Parse commands from JSON
        if results[0]:
            for command_json in results[0]:
                try:
                    command_data = json.loads(command_json)
                    command = self._deserialize_command(command_data)
                    if command:
                        commands.append(command)
                except (json.JSONDecodeError, ValueError):
                    # Skip invalid commands
                    continue

        return commands

    def send_command(self, command: GraphEngineCommand) -> None:
        """
        Send a command to Redis.

        Args:
            command: The command to send
        """
        command_json = json.dumps(command.model_dump())

        # Push to list and set expiry
        with self._redis.pipeline() as pipe:
            pipe.rpush(self._key, command_json)
            pipe.expire(self._key, self._command_ttl)
            pipe.execute()

    def _deserialize_command(self, data: dict) -> Optional[GraphEngineCommand]:
        """
        Deserialize a command from dictionary data.

        Args:
            data: Command data dictionary

        Returns:
            Deserialized command or None if invalid
        """
        try:
            command_type = CommandType(data.get("command_type"))

            if command_type == CommandType.ABORT:
                return AbortCommand(**data)
            else:
                # For other command types, use base class
                return GraphEngineCommand(**data)

        except (ValueError, TypeError):
            return None
