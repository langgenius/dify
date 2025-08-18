# Event Management

Event handling, collection, and emission pipeline.

## Components

### EventHandlerRegistry

Central registry that handles all event types with a unified interface.

- `handle_event(event)` - Main entry point for event processing
- Internal dispatch to specialized handlers based on event type
- Coordinates subsystems (state management, graph traversal, error handling)

### EventEmitter

Generator interface for event streaming.

- `emit_events()` - Yield events
- `mark_complete()` - Signal completion

### EventCollector

Thread-safe event buffer with layer notification.

- `collect(event)` - Add event and notify layers
- `get_new_events()` - Get recent events
- `set_layers(layers)` - Configure layers

### Features

- **Unified Event Handling**: Single entry point for all events
- **Subsystem Coordination**: Integrates with graph traversal, state management, and error handling
- **Stream Processing**: Handles streaming events and response coordination
- **Error Recovery**: Integrates with error handling strategies

## Usage

```python
collector = EventCollector()
emitter = EventEmitter(collector)
handler_registry = EventHandlerRegistry(
    graph=graph,
    graph_runtime_state=state,
    graph_execution=execution,
    response_coordinator=coordinator,
    # ... other dependencies
)

# Handle events directly
handler_registry.handle_event(event)

# Stream events
for event in emitter.emit_events():
    process_event(event)
```

## Event Flow

```text
Workers → EventHandlerRegistry → State Updates
                ↓
          EventCollector → Layers
                ↓
          EventEmitter → Consumers
```

## Event Types

- **Node Events**: Started, Succeeded, Failed, Retry, Exception, StreamChunk
- **Graph Events**: Started, Succeeded, Failed, Aborted
- **Container Events**: Iteration/Loop events
