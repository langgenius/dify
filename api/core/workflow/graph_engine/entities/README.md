# Entities

Pydantic command models for workflow control.

## Components

### CommandType Enum

- `ABORT` - Terminate workflow
- `PAUSE` - Suspend execution
- `RESUME` - Continue execution

### GraphEngineCommand

Base model for all commands.

- `command_type` - Command type enum
- `payload` - Optional command data

### AbortCommand

Abort workflow with optional reason.

- `command_type` - Always ABORT
- `reason` - Optional abort reason

## Usage

```python
# Abort command
abort_cmd = AbortCommand(reason="User cancelled")

# Generic command
pause_cmd = GraphEngineCommand(
    command_type=CommandType.PAUSE,
    payload={"checkpoint": "node-5"}
)

# JSON serialization
json_data = abort_cmd.model_dump_json()
command = AbortCommand.model_validate_json(json_data)
```
