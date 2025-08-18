# Domain

Core domain models for workflow execution.

## Components

### ExecutionContext

Immutable value object with execution parameters.

- `tenant_id`, `app_id`, `user_id` - Multi-tenant identifiers
- `max_execution_steps` - Loop prevention limit
- `max_execution_time` - Timeout in seconds

### GraphExecution

Aggregate root managing execution lifecycle.

- `get_next_ready_nodes()` - Get executable nodes
- `mark_node_running/completed/failed()` - Update states
- `is_completed()` - Check completion

### NodeExecution

Entity tracking node state.

- `node_id` - Unique identifier
- `status` - pending/running/completed/failed
- `retry_count` - Retry attempts
- `outputs` - Execution results
- `error` - Failure details

## Usage

```python
context = ExecutionContext(
    tenant_id="tenant-123",
    app_id="app-456",
    max_execution_steps=1000
)

graph_execution = GraphExecution(
    graph=workflow_graph,
    context=context
)
```

## Model Structure

```text
GraphExecution (Aggregate Root)
├── ExecutionContext (Value Object)
├── NodeExecution[] (Entities)
└── Graph (Reference)
```
