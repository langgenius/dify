# Layers

Pluggable middleware for engine extensions.

## Components

### Layer (base)

Abstract base class for layers.

- `initialize()` - Receive runtime context
- `on_graph_start()` - Execution start hook
- `on_event()` - Process all events
- `on_graph_end()` - Execution end hook

### DebugLoggingLayer

Comprehensive execution logging.

- Configurable detail levels
- Tracks execution statistics
- Truncates long values

## Usage

```python
debug_layer = DebugLoggingLayer(
    level="INFO",
    include_outputs=True
)

engine = GraphEngine(graph)
engine.add_layer(debug_layer)
engine.run()
```

## Custom Layers

```python
class MetricsLayer(Layer):
    def on_event(self, event):
        if isinstance(event, NodeRunSucceededEvent):
            self.metrics[event.node_id] = event.elapsed_time
```

## Configuration

**DebugLoggingLayer Options:**

- `level` - Log level (INFO, DEBUG, ERROR)
- `include_inputs/outputs` - Log data values
- `max_value_length` - Truncate long values
