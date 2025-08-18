# Command Processing

Processes external commands to control running workflows.

## Components

### CommandProcessor

Polls channels and dispatches commands to handlers.

- `process_commands()` - Process all pending commands
- `_dispatch_command()` - Route by command type

### AbortCommandHandler

Terminates workflow execution.

- `handle()` - Apply abort and generate event

### CommandHandler Protocol

Interface for command handlers.

- `handle(command, graph_execution)` - Process command

## Usage

```python
processor = CommandProcessor(
    command_channel=channel,
    graph_execution=graph_execution
)

# Process commands in main loop
processor.process_commands()
```

## Flow

1. External system sends command to channel
2. Processor fetches commands during execution
3. Commands dispatched to handlers
4. Handlers modify execution state
5. Changes trigger events
