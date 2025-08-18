# Orchestration

High-level coordination of engine subsystems.

## Components

### Dispatcher

Processes events from workers in separate thread.

- `start()` - Start dispatcher thread
- `stop()` - Signal stop
- `wait()` - Wait for completion

### ExecutionCoordinator

Coordinates execution flow and completion.

- `check_commands()` - Process commands
- `check_scaling()` - Apply worker scaling
- `is_execution_complete()` - Check completion
- `mark_complete/failed()` - Set final state

## Usage

```python
coordinator = ExecutionCoordinator(
    command_processor=command_processor,
    worker_pool=worker_pool
)

dispatcher = Dispatcher(
    event_queue=event_queue,
    execution_coordinator=coordinator
)

dispatcher.start()

while not coordinator.is_execution_complete():
    coordinator.check_commands()
    coordinator.check_scaling()

dispatcher.stop()
```

## Execution States

- **Running** - Active execution
- **Complete** - All nodes done
- **Failed** - Error occurred
- **Timeout** - Time limit exceeded
- **Aborted** - External abort

## Threading Model

```text
Main Thread → Monitors execution
Dispatcher Thread → Processes events
Worker Threads → Execute nodes
```
