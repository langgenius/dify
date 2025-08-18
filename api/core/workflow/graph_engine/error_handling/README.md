# Error Handling

Strategy-based error recovery for node failures.

## Components

### ErrorHandler

Coordinates error strategies and tracks retries.

- `handle_node_failure(event)` - Process failure
- `get_retry_count(node_id)` - Get retry count
- `reset_retry_count(node_id)` - Reset count

### Error Strategies

#### RetryStrategy

Retries with configurable limits and delays.

#### AbortStrategy

Terminates workflow on failure.

#### FailBranchStrategy

Routes to failure branch.

#### DefaultValueStrategy

Continues with default values.

## Usage

```python
error_handler = ErrorHandler(graph)

# Handle failure
recovery_event = error_handler.handle_node_failure(failure_event)

if recovery_event is None:
    abort_workflow()
elif isinstance(recovery_event, NodeRunRetryEvent):
    retry_node(recovery_event)
elif isinstance(recovery_event, NodeRunExceptionEvent):
    process_exception(recovery_event)
```

## Strategy Selection

1. Check `node.retry` → Apply RetryStrategy
2. Check `node.error_strategy`:
   - ABORT → AbortStrategy
   - FAIL_BRANCH → FailBranchStrategy
   - DEFAULT_VALUE → DefaultValueStrategy

## Node Configuration

```python
node.retry = True
node.retry_config = {
    "max_retries": 3,
    "retry_interval_seconds": 1.0
}
node.error_strategy = ErrorStrategyEnum.FAIL_BRANCH
```
