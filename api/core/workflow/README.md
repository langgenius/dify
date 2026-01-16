# Workflow

## Project Overview

This is the workflow graph engine module of Dify, implementing a queue-based distributed workflow execution system. The engine handles agentic AI workflows with support for parallel execution, node iteration, conditional logic, and external command control.

## Architecture

### Core Components

The graph engine follows a layered architecture with strict dependency rules:

1. **Graph Engine** (`graph_engine/`) - Orchestrates workflow execution

   - **Manager** - External control interface for stop/pause/resume commands
   - **Worker** - Node execution runtime
   - **Command Processing** - Handles control commands (abort, pause, resume)
   - **Event Management** - Event propagation and layer notifications
   - **Graph Traversal** - Edge processing and skip propagation
   - **Response Coordinator** - Path tracking and session management
   - **Layers** - Pluggable middleware (debug logging, execution limits)
   - **Command Channels** - Communication channels (InMemory, Redis)

1. **Graph** (`graph/`) - Graph structure and runtime state

   - **Graph Template** - Workflow definition
   - **Edge** - Node connections with conditions
   - **Runtime State Protocol** - State management interface

1. **Nodes** (`nodes/`) - Node implementations

   - **Base** - Abstract node classes and variable parsing
   - **Specific Nodes** - LLM, Agent, Code, HTTP Request, Iteration, Loop, etc.

1. **Events** (`node_events/`) - Event system

   - **Base** - Event protocols
   - **Node Events** - Node lifecycle events

1. **Entities** (`entities/`) - Domain models

   - **Variable Pool** - Variable storage
   - **Graph Init Params** - Initialization configuration

## Key Design Patterns

### Command Channel Pattern

External workflow control via Redis or in-memory channels:

```python
# Send stop command to running workflow
channel = RedisChannel(redis_client, f"workflow:{task_id}:commands")
channel.send_command(AbortCommand(reason="User requested"))
```

### Layer System

Extensible middleware for cross-cutting concerns:

```python
engine = GraphEngine(graph)
engine.layer(DebugLoggingLayer(level="INFO"))
engine.layer(ExecutionLimitsLayer(max_nodes=100))
```

`engine.layer()` binds the read-only runtime state before execution, so layer hooks
can assume `graph_runtime_state` is available.

### Event-Driven Architecture

All node executions emit events for monitoring and integration:

- `NodeRunStartedEvent` - Node execution begins
- `NodeRunSucceededEvent` - Node completes successfully
- `NodeRunFailedEvent` - Node encounters error
- `GraphRunStartedEvent/GraphRunCompletedEvent` - Workflow lifecycle

### Variable Pool

Centralized variable storage with namespace isolation:

```python
# Variables scoped by node_id
pool.add(["node1", "output"], value)
result = pool.get(["node1", "output"])
```

## Import Architecture Rules

The codebase enforces strict layering via import-linter:

1. **Workflow Layers** (top to bottom):

   - graph_engine → graph_events → graph → nodes → node_events → entities

1. **Graph Engine Internal Layers**:

   - orchestration → command_processing → event_management → graph_traversal → domain

1. **Domain Isolation**:

   - Domain models cannot import from infrastructure layers

1. **Command Channel Independence**:

   - InMemory and Redis channels must remain independent

## Common Tasks

### Adding a New Node Type

1. Create node class in `nodes/<node_type>/`
1. Inherit from `BaseNode` or appropriate base class
1. Implement `_run()` method
1. Register in `nodes/node_mapping.py`
1. Add tests in `tests/unit_tests/core/workflow/nodes/`

### Implementing a Custom Layer

1. Create class inheriting from `Layer` base
1. Override lifecycle methods: `on_graph_start()`, `on_event()`, `on_graph_end()`
1. Add to engine via `engine.layer()`

### Debugging Workflow Execution

Enable debug logging layer:

```python
debug_layer = DebugLoggingLayer(
    level="DEBUG",
    include_inputs=True,
    include_outputs=True
)
```
