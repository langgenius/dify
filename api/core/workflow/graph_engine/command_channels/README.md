# Command Channels

Channel implementations for external workflow control.

## Components

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
# Local execution
channel = InMemoryChannel()
channel.send_command(AbortCommand(graph_id="workflow-123"))

# Distributed execution
redis_channel = RedisChannel(
    redis_client=redis_client,
    channel_key="workflow:123:commands"
)
```
