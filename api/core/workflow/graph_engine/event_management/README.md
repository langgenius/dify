# Event Management

Event collection, routing, and emission pipeline.

## Components

### EventRouter

Routes events to handlers by type.

- `route_event(event)` - Main routing
- `register_handler(type, handler)` - Add handler

### EventEmitter

Generator interface for event streaming.

- `emit_events()` - Yield events
- `mark_complete()` - Signal completion

### EventCollector

Thread-safe event buffer with layer notification.

- `collect(event)` - Add event and notify layers
- `get_new_events()` - Get recent events
- `set_layers(layers)` - Configure layers

### EventHandlerRegistry

Registry of event handlers.

- Handles node/graph start, success, failure
- Manages retry and exception events

## Usage

```python
collector = EventCollector()
router = EventRouter(collector)
emitter = EventEmitter(collector)

# Route events
router.route_event(event)

# Stream events
for event in emitter.emit_events():
    process_event(event)
```

## Event Flow

```text
Workers → EventRouter → Handlers
            ↓
        EventCollector → Layers
            ↓
        EventEmitter → Consumers
```

## Event Types

- **Node Events**: Started, Succeeded, Failed, Retry, Exception, StreamChunk
- **Graph Events**: Started, Succeeded, Failed, Aborted
- **Container Events**: Iteration/Loop events
