"""Redis-based implementation of CommandChannel for distributed scenarios.

This implementation uses Redis lists for command queuing, supporting
multi-instance deployments and cross-server communication.
Each instance uses a unique key for its command queue.
"""

import json
from contextlib import AbstractContextManager
from typing import Any, Protocol, cast, final

from pydantic import TypeAdapter

from ..entities import Command

_COMMAND_ADAPTER = TypeAdapter(Command)


def _migrate_command_payload(data: object) -> object:
    """Normalize the legacy Redis wire shape for variable update commands.

    Older producers wrapped each serialized variable as ``{"value": variable}``.
    The public wrapper type no longer exists, but Redis commands can remain queued
    for up to one hour during a rolling deployment. This boundary-only migration
    unwraps those list items without reintroducing a Python compatibility type or
    changing already-current payloads.

    Args:
        data: Decoded command JSON received from Redis. Non-object JSON is
            returned unchanged so command validation can reject it normally.

    Returns:
        The original mapping when no migration is needed, otherwise a shallow copy
        whose ``updates`` list contains the serialized variables directly.

    """
    if not isinstance(data, dict):
        return data

    command_data = cast(dict[str, Any], data)
    updates = command_data.get("updates")
    if command_data.get("command_type") != "update_variables" or not isinstance(
        updates,
        list,
    ):
        return command_data
    migrated = [
        update["value"]
        if isinstance(update, dict) and set(update) == {"value"}
        else update
        for update in updates
    ]
    return (
        command_data if migrated == updates else {**command_data, "updates": migrated}
    )


class RedisPipelineProtocol(Protocol):
    """Minimal Redis pipeline contract used by the command channel."""

    def lrange(self, name: str, start: int, end: int) -> Any: ...

    def delete(self, *names: str) -> Any: ...

    def execute(self) -> list[Any]: ...

    def rpush(self, name: str, *values: str) -> Any: ...

    def expire(self, name: str, time: int) -> Any: ...

    def set(self, name: str, value: str, ex: int | None = None) -> Any: ...


class RedisClientProtocol(Protocol):
    """Redis client contract required by the command channel."""

    def pipeline(self) -> AbstractContextManager[RedisPipelineProtocol]: ...


@final
class RedisChannel:
    """Redis-based command channel implementation for distributed systems.

    Each instance uses a unique Redis key for its command queue.
    Commands are JSON-serialized for transport.
    """

    def __init__(
        self,
        redis_client: RedisClientProtocol,
        channel_key: str,
        command_ttl: int = 3600,
    ) -> None:
        """Initialize the Redis channel.

        Args:
            redis_client: Redis client instance
            channel_key: Unique key for this channel's command queue
            command_ttl: TTL for command keys in seconds (default: 3600)

        """
        self._redis = redis_client
        self._key = channel_key
        self._command_ttl = command_ttl
        self._pending_key = f"{channel_key}:pending"

    def fetch_commands(self) -> list[Command]:
        """Fetch all pending commands from Redis.

        Returns:
            List of pending commands (drains the Redis list)

        """
        commands: list[Command] = []

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
                    command = self.deserialize_command(command_data)
                    if command:
                        commands.append(command)
                except (json.JSONDecodeError, ValueError):
                    # Skip invalid commands
                    continue

        return commands

    def send_command(self, command: Command) -> None:
        """Send a command using the wire format understood by both engine versions.

        Pre-refactor consumers require a separate pending marker before reading the
        command list and expect variable updates to wrap each variable in a
        ``{"value": variable}`` object. New consumers accept that legacy payload at
        deserialization, so retaining the old producer format keeps rolling
        deployments bidirectionally compatible without duplicating commands.

        Args:
            command: The command to send

        """
        # Remove the legacy marker and wrapper after pre-refactor consumers have
        # been retired for at least one command TTL.
        command_data = command.model_dump(mode="json")
        if command.command_type == "update_variables":
            command_data["updates"] = [
                {"value": update} for update in command_data["updates"]
            ]
        command_json = json.dumps(command_data)

        # Push to list and set expiry
        with self._redis.pipeline() as pipe:
            pipe.rpush(self._key, command_json)
            pipe.expire(self._key, self._command_ttl)
            pipe.set(self._pending_key, "1", ex=self._command_ttl)
            pipe.execute()

    def deserialize_command(
        self,
        data: object,
    ) -> Command | None:
        """Deserialize a command from dictionary data.

        Args:
            data: Decoded JSON value received from the command queue.

        Returns:
            Deserialized command or None if invalid

        """
        try:
            return _COMMAND_ADAPTER.validate_python(_migrate_command_payload(data))
        except (ValueError, TypeError):
            return None
