# Graph Engine

Queue-based workflow execution engine that orchestrates the parallel execution of workflow graphs using a dispatcher-worker architecture.

## Components Overview

### Core Components

- **GraphEngine** (`graph_engine.py`): Main orchestrator that coordinates workflow execution using dispatcher and worker threads
- **Manager** (`manager.py`): External interface for sending control commands to running workflows via Redis
- **Worker** (`worker.py`): Thread that pulls nodes from ready queue, executes them, and pushes events to event queue
- **WorkerPoolManager** (`worker_pool_manager.py`): Dynamically manages worker pool size based on graph complexity and runtime metrics
- **ExecutingNodesManager** (`executing_nodes_manager.py`): Thread-safe tracker for nodes currently being executed

### Data Management

- **OutputRegistry** (`output_registry/`): Thread-safe storage for node outputs supporting both scalar values and streaming data
- **ResponseCoordinator** (`response_coordinator/`): Manages ordered streaming of response nodes based on execution paths

### Communication

- **CommandChannel** (`command_channels/`): Abstraction for sending control commands (stop/pause/resume) to running workflows
- **Commands** (`entities/commands.py`): Command definitions for workflow control operations

### Extensions

- **Layers** (`layers/`): Pluggable middleware for extending engine functionality (debugging, monitoring)

## Architecture Flow

```mermaid
flowchart TB
    Start([Start]) --> GE[GraphEngine]
    
    GE --> |Initialize| Components{Create Components}
    Components --> OM[OutputRegistry]
    Components --> RC[ResponseCoordinator]
    Components --> WPM[WorkerPoolManager]
    Components --> ENM[ExecutingNodesManager]
    
    Components --> |Calculate Workers| WC[Worker Count]
    WC --> |Create| Workers[Worker Threads 1..N]
    
    GE --> |Start| Dispatcher[Dispatcher Thread]
    
    Dispatcher --> |Monitor| EQ[Event Queue]
    Dispatcher --> |Check Ready| Graph[Graph Structure]
    Dispatcher --> |Push Ready| RQ[Ready Queue]
    
    Workers --> |Pull Node| RQ
    Workers --> |Execute| Node[Node Execution]
    Node --> |Generate| Events[Events]
    Events --> |Push| EQ
    
    EQ --> |Stream Events| RC
    RC --> |Coordinate| OM
    RC --> |Output| Stream[Response Stream]
    
    Dispatcher --> |Check| CC[Command Channel]
    CC --> |Abort/Pause| Control[Control Flow]
    
    Dispatcher --> |All Complete?| Check{Completion Check}
    Check --> |No| Dispatcher
    Check --> |Yes| End([End])
    
    style GE fill:#f9f,stroke:#333,stroke-width:4px
    style Dispatcher fill:#bbf,stroke:#333,stroke-width:2px
    style Workers fill:#bfb,stroke:#333,stroke-width:2px
```

## Component Relationships (UML)

```mermaid
classDiagram
    class GraphEngine {
        -dispatcher_thread: Thread
        -workers: list[Worker]
        -ready_queue: Queue
        -event_queue: Queue
        -graph: Graph
        -output_registry: OutputRegistry
        -response_coordinator: ResponseCoordinator
        -executing_nodes_manager: ExecutingNodesManager
        -worker_pool_manager: WorkerPoolManager
        +run() Generator[GraphEngineEvent]
        -_dispatcher_thread_target()
        -_schedule_ready_nodes()
        -_process_event()
    }
    
    class Worker {
        -ready_queue: Queue
        -event_queue: Queue
        -graph: Graph
        -worker_id: int
        +run()
        -_execute_node()
    }
    
    class OutputRegistry {
        -_scalars: VariablePool
        -_streams: dict[tuple, Stream]
        -_lock: RLock
        +set_scalar()
        +get_scalar()
        +append_chunk()
        +pop_chunk()
        +has_unread()
        +close_stream()
    }
    
    class ResponseCoordinator {
        -registry: OutputRegistry
        -graph: Graph
        -active_session: ResponseSession
        -waiting_sessions: deque
        -_paths_maps: dict
        +register()
        +on_edge_taken()
        +intercept_event()
        +try_flush()
    }
    
    class WorkerPoolManager {
        -min_workers: int
        -max_workers: int
        -idle_workers: dict
        +calculate_initial_workers()
        +should_scale_up()
        +should_scale_down()
        +get_optimal_worker_count()
    }
    
    class ExecutingNodesManager {
        -_executing_nodes: set
        -_lock: Lock
        +add()
        +remove()
        +is_empty()
        +count()
    }
    
    class Manager {
        <<static>>
        +send_stop_command()
        +send_pause_command()
        +send_resume_command()
    }
    
    class CommandChannel {
        <<interface>>
        +send_command()
        +receive_command()
        +has_command()
    }
    
    class RedisChannel {
        -redis_client: Redis
        -channel_key: str
        +send_command()
        +receive_command()
    }
    
    class InMemoryChannel {
        -queue: Queue
        +send_command()
        +receive_command()
    }
    
    GraphEngine --> Worker: creates/manages
    GraphEngine --> OutputRegistry: uses
    GraphEngine --> ResponseCoordinator: uses
    GraphEngine --> WorkerPoolManager: uses
    GraphEngine --> ExecutingNodesManager: uses
    GraphEngine --> CommandChannel: monitors
    
    ResponseCoordinator --> OutputRegistry: reads from
    Worker --> GraphEngine: sends events
    
    Manager --> CommandChannel: sends commands
    CommandChannel <|-- RedisChannel: implements
    CommandChannel <|-- InMemoryChannel: implements
```

## Execution Sequence

```mermaid
sequenceDiagram
    participant Client
    participant GraphEngine
    participant Dispatcher
    participant Worker
    participant Node
    participant OutputRegistry
    participant ResponseCoordinator
    
    Client->>GraphEngine: run()
    GraphEngine->>Dispatcher: start()
    GraphEngine->>Worker: start(1..N)
    
    loop Execution Loop
        Dispatcher->>Dispatcher: schedule_ready_nodes()
        Dispatcher->>Worker: ready_queue.put(node_id)
        Worker->>Node: execute()
        Node->>Node: process()
        Node-->>OutputRegistry: store_output()
        Node-->>Worker: return events
        Worker->>Dispatcher: event_queue.put(events)
        Dispatcher->>Dispatcher: process_event()
        Dispatcher->>ResponseCoordinator: intercept_event()
        ResponseCoordinator->>OutputRegistry: get data
        ResponseCoordinator-->>Client: stream response
    end
    
    Dispatcher->>GraphEngine: completion
    GraphEngine-->>Client: final results
```

## Key Design Principles

### 1. Queue-Based Architecture

Replaces traditional thread pool with explicit queues for better control and coordination of parallel execution.

### 2. Event-Driven Processing

All node executions generate events that drive the workflow forward, enabling reactive and responsive execution.

### 3. Separation of Concerns

Each component has a single, well-defined responsibility, making the system modular and maintainable.

### 4. Thread Safety

All shared state is protected by appropriate locking mechanisms to ensure correct concurrent execution.

### 5. Dynamic Scaling

Worker pool size adapts to workload, optimizing resource usage for both simple and complex workflows.

### 6. Streaming Support

Native support for streaming responses allows progressive output delivery for better user experience.

## Usage Pattern

1. **Initialization**: GraphEngine creates all necessary components and calculates optimal worker count
2. **Execution Start**: Dispatcher thread and worker threads begin processing
3. **Node Scheduling**: Dispatcher identifies ready nodes and queues them for execution
4. **Node Execution**: Workers pull nodes from queue and execute them in parallel
5. **Event Processing**: Execution events update graph state and trigger downstream nodes
6. **Response Streaming**: ResponseCoordinator manages ordered output delivery
7. **Completion**: Engine detects workflow completion and returns final results

## Control Commands

The engine supports external control through the Manager interface:

- **Stop**: Immediately abort workflow execution
- **Pause**: Suspend execution (preserves state)
- **Resume**: Continue paused execution

Commands are delivered via pluggable CommandChannel implementations (Redis for distributed, InMemory for local).
