<!-- knowledge
last_checked: "2026-09-08T17:04:02Z"
-->
# Commands

Command processing and channels for external workflow control.

The supported command union contains `AbortCommand`, `PauseCommand`, and
`UpdateVariablesCommand`. Their `command_type` literals are used to deserialize
commands received from distributed channels.

## Components

### CommandProcessor

Polls a command channel and applies commands to the current graph execution.

### InMemoryChannel

Thread-safe in-memory queue for single-process deployments.

- `fetch_commands()` - Get pending commands
- `send_command()` - Add command to queue

### RedisChannel

Redis-based queue for distributed deployments.

- `fetch_commands()` - Get commands with JSON deserialization
- `send_command()` - Store commands with TTL

## Usage

```python
from graphon.engine.command import AbortCommand, InMemoryChannel, RedisChannel

# Local execution
channel = InMemoryChannel()
channel.send_command(AbortCommand(reason="stop"))

# Distributed execution
redis_channel = RedisChannel(
    redis_client=redis_client, channel_key="workflow:123:commands"
)
```
