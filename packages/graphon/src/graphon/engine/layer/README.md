<!-- knowledge
last_checked: "2026-09-08T17:04:02Z"
-->
# Layers

Pluggable middleware for engine extensions.

## Components

### Layer (base)

Base class with optional lifecycle hooks for layers.

- `initialize()` - Receive runtime context (runtime state is bound here and always available to hooks)
- `on_graph_start()` - Execution start hook
- `on_event()` - Process all events
- `on_graph_end()` - Execution end hook
- `node_run_context(node, parent_execution_id=...)` - Host context manager activated
  for each worker task, including every container resume. Entry and exit always
  occur in the same worker context, even on suspension or failure. The parent ID
  is the direct container's node execution ID, or `None` for root-frame nodes.
- `on_node_run_start(node)` / `on_node_run_end(node, error, result_event)` - Logical
  node lifetime hooks. A container may suspend between these hooks and finish on
  another worker. Keep tracing spans alive across suspension, but activate their
  context only inside `node_run_context`; do not carry context tokens between
  logical lifetime hooks. These contexts are not included in runtime snapshots.

Return a fresh context manager for each task. It surrounds node hooks and
consumption of the node or resume generator; graph and event hooks run outside
this scope. Entry/exit exceptions are logged and isolated, and the manager cannot
suppress node execution errors. See the [worker](../worker/worker.py) and
[context tests](../../../../tests/engine/test_layer_node_run_context.py).

## Usage

```python
from graphon.engine.layer import Layer
from graphon.engine_events import EngineEvent, NodeRunSucceededEvent


class MetricsLayer(Layer):
    def __init__(self):
        """Create storage for elapsed time collected during one engine run."""
        super().__init__()
        self.metrics: dict[str, float] = {}

    def on_graph_start(self) -> None:
        """Reset collected metrics before the engine starts a new graph run."""
        self.metrics.clear()

    def on_event(self, event: EngineEvent) -> None:
        """Record elapsed time when a node run succeeds."""
        if isinstance(event, NodeRunSucceededEvent) and event.finished_at is not None:
            duration = event.finished_at - event.start_at
            self.metrics[event.node_id] = duration.total_seconds()
```

`engine.add_layer()` binds the read-only runtime state before execution, so
`runtime_state` is always available inside layer hooks.

`runtime_state.dumps()` requires quiescent execution. Start, node, and event
callbacks (including terminal events) raise `RuntimeError` if they try to take
a runtime snapshot. Persist in `on_graph_end` after execution threads have stopped,
or after fully consuming the run iterator. See the
[serialization tests](../../../../tests/engine/test_runtime_state_serialization.py)
for resumable pauses and shutdown timeouts.
