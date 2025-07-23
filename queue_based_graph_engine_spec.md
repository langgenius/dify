# Queue-Based Graph Engine Specification

## Overview

This document specifies the design and implementation of a new queue-based graph engine for workflow execution. The new engine will replace the current thread-based execution model with a more scalable and manageable queue-based approach.

## Architecture Components

### 1. Graph

A data structure representing the workflow definition, independent of execution.

**Responsibilities:**
- Store nodes and edges
- Provide graph traversal methods
- Parse from dictionary representation
- Validate graph structure (cycles, connectivity)

**Key Methods:**
```python
class Graph:
    nodes: Dict[str, BaseNode]
    edges: List[Edge]
    
    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> 'Graph':
        """Parse a dictionary to create a Graph instance"""
        
    def get_node(self, node_id: str) -> BaseNode:
        """Get node by ID"""
        
    def get_edges_from(self, node_id: str) -> List[Edge]:
        """Get all outgoing edges from a node"""
        
    def get_edges_to(self, node_id: str) -> List[Edge]:
        """Get all incoming edges to a node"""
        
    def validate(self) -> None:
        """Validate graph structure"""
```

### 2. GraphEngine

The execution engine that processes a Graph using queue-based scheduling.

**Responsibilities:**
- Execute graphs using queue-based scheduling
- Manage execution queues (ready_q, running_q, completed_q)
- Schedule nodes based on preconditions
- Handle event propagation
- Support suspend/resume operations

**Key Methods:**
```python
class GraphEngine:
    def __init__(self, graph: Graph, runtime_state: GraphRuntimeState):
        """Initialize with graph and runtime state"""
        
    def run(self, start_node_id: str) -> None:
        """Start execution from specified node"""
        
    def resume(self) -> None:
        """Resume execution from saved state"""
        
    def suspend(self) -> GraphRuntimeState:
        """Suspend execution and return current state"""
        
    def schedule(self) -> None:
        """Main scheduling loop - moves nodes between queues"""
        
    def check_preconditions(self, node: BaseNode) -> bool:
        """Check if node's preconditions are satisfied"""
        
    def execute_node(self, node: ExecutableNode) -> None:
        """Execute a single node"""
```

**Queue Management:**
- `ready_q`: Nodes whose preconditions are satisfied
- `running_q`: Currently executing nodes
- `completed_q`: Successfully completed nodes
- `failed_q`: Failed nodes for retry or error handling

### 3. GraphRuntimeState

Captures the complete execution state for suspend/resume functionality.

**Responsibilities:**
- Store queue states
- Track node execution status
- Maintain variable pool state
- Support serialization/deserialization

```python
@dataclass
class GraphRuntimeState:
    # Queue states
    ready_nodes: List[str]
    running_nodes: List[str]
    completed_nodes: List[str]
    failed_nodes: List[str]
    
    # Node execution states
    node_states: Dict[str, NodeExecutionState]
    
    # Variable pool
    variables: Dict[str, Any]
    
    # Execution metadata
    start_time: datetime
    last_checkpoint: datetime
    execution_id: str
    
    def to_dict(self) -> dict[str, Any]:
        """Serialize state to dictionary"""
        
    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> 'GraphRuntimeState':
        """Deserialize state from dictionary"""
```

### 4. Edge

Represents connections between nodes in the graph.

```python
@dataclass
class Edge:
    source_node_id: str
    target_node_id: str
    condition: Optional[Callable[[GraphEngine], bool]] = None
    priority: int = 0
```

### 5. Node Hierarchy

#### BaseNode

Abstract base class for all nodes.

```python
class BaseNode(ABC):
    node_id: str
    node_type: NodeType
    data: dict[str, Any]
    
    @abstractmethod
    def preconditions(self) -> List[Callable[[GraphEngine], bool]]:
        """Return list of precondition checks"""
        
    @classmethod
    @abstractmethod
    def from_dict(cls, data: dict[str, Any]) -> Self:
        """Factory method for node creation with validation"""
        
    def get_dependencies(self) -> List[str]:
        """Return list of node IDs this node depends on"""
```

#### ExecutableNode

Nodes that perform actual work.

```python
class ExecutableNode(BaseNode):
    @abstractmethod
    async def execute(self, context: ExecutionContext) -> NodeResult:
        """Execute the node's logic"""
        
    def preconditions(self) -> List[Callable[[GraphEngine], bool]]:
        """Default: all upstream nodes must be completed"""
        return [
            lambda engine: all(
                engine.is_node_completed(dep_id) 
                for dep_id in self.get_dependencies()
            )
        ]
```

### 6. Special Node Types

#### StartNode
- **Characteristics:**
  - Always has satisfied preconditions
  - No dependencies
  - Triggers initial execution
  - Only one per workflow
  - Cannot be skipped

```python
class StartNode(ExecutableNode):
    def preconditions(self) -> List[Callable[[GraphEngine], bool]]:
        return []  # Always ready
        
    async def execute(self, context: ExecutionContext) -> NodeResult:
        return NodeResult(status="success", outputs={})
```

#### EndNode
- **Characteristics:**
  - Marks workflow completion
  - Can have multiple end nodes (different paths)
  - Triggers cleanup operations
  - Collects final outputs

```python
class EndNode(ExecutableNode):
    def preconditions(self) -> List[Callable[[GraphEngine], bool]]:
        # At least one path must reach this node
        return [lambda engine: any(
            engine.is_node_completed(dep_id) 
            for dep_id in self.get_dependencies()
        )]
```

## Execution Flow

### 1. Graph Creation Phase
```python
# Parse from dictionary
graph_data = {
    "nodes": [...],
    "edges": [...]
}
graph = Graph.from_dict(graph_data)
graph.validate()
```

### 2. Engine Initialization
```python
# Fresh start
runtime_state = GraphRuntimeState.create_new()
engine = GraphEngine(graph, runtime_state)
engine.run(start_node_id="start_node")

# Resume from suspended state
saved_state = GraphRuntimeState.from_dict(saved_state_dict)
engine = GraphEngine(graph, saved_state)
engine.resume()
```

### 3. Scheduling Loop
```
while not all_nodes_processed():
    # Check completed nodes and update downstream
    for node_id in completed_q:
        for edge in graph.get_edges_from(node_id):
            target_node = graph.get_node(edge.target_node_id)
            if check_preconditions(target_node):
                ready_q.add(target_node)
    
    # Execute ready nodes
    while ready_q and has_available_workers():
        node = ready_q.pop()
        running_q.add(node)
        submit_to_worker(node)
    
    # Handle timeouts and failures
    check_timeouts()
    process_failed_nodes()
    
    # Checkpoint state periodically
    if should_checkpoint():
        runtime_state.update_from_engine(engine)
```

### 4. Node Execution
```
1. Worker picks up node from queue
2. Validates preconditions (double-check)
3. Execute node logic
4. Update variable pool in runtime state
5. Emit events
6. Move to completed_q or failed_q
```

### 5. Suspend/Resume Operations
```python
# Suspend
current_state = engine.suspend()
state_dict = current_state.to_dict()
# Save state_dict to database/storage

# Resume
saved_state = GraphRuntimeState.from_dict(state_dict)
engine = GraphEngine(graph, saved_state)
engine.resume()
```

## Implementation Plan

### Phase 1: Core Infrastructure
1. Implement Graph class with `from_dict` parsing
2. Implement base node classes (BaseNode, ExecutableNode)
3. Create GraphRuntimeState for state management
4. Build precondition framework
5. Implement GraphEngine with queue management

### Phase 2: Node Migration
1. Convert existing nodes to ExecutableNode
2. Implement `from_dict` methods for each node type
3. Add precondition logic to each node type
4. Update node execution to async

### Phase 3: State Management
1. Implement suspend/resume functionality
2. Add checkpoint mechanisms
3. Create state persistence layer
4. Add recovery mechanisms

### Phase 4: Advanced Features
1. Priority-based scheduling
2. Resource-aware execution
3. Distributed execution support
4. Advanced retry mechanisms
5. Performance optimizations

## Benefits

1. **Scalability**: Easy to distribute across workers
2. **Resource Management**: Better control over concurrent executions
3. **Observability**: Clear queue states for monitoring
4. **Fault Tolerance**: Failed nodes can be retried independently
5. **Flexibility**: Easy to add new scheduling strategies

## Migration Strategy

1. **Compatibility Layer**: Maintain backward compatibility during transition
2. **Feature Flag**: Toggle between old and new engines
3. **Gradual Rollout**: Test with simple workflows first
4. **Performance Monitoring**: Compare metrics between implementations
5. **Rollback Plan**: Easy switch back to old engine if needed

## Key Design Decisions

1. **Graph and GraphEngine Separation**: Graph is a pure data structure, GraphEngine handles execution
2. **GraphRuntimeState**: Enables suspend/resume functionality with complete state capture
3. **No ContainerNode Initially**: Focus on core execution model first
4. **Queue-Based Scheduling**: Better resource management and scalability than thread-based approach

## Open Questions

1. **Queue Backend**: In-memory, Redis, or database-backed?
2. **Worker Pool**: Thread-based, process-based, or distributed?
3. **State Persistence**: How frequently to checkpoint?
4. **Event System**: Keep current or migrate to message queue?
5. **Priority Algorithm**: Simple numeric or complex scoring?
6. **Graph Parsing**: Should we reuse existing node parsing logic or create new?

## Additional Components

### 7. ExecutionContext

Provides runtime context for node execution.

```python
@dataclass
class ExecutionContext:
    graph_engine: GraphEngine
    runtime_state: GraphRuntimeState
    variable_pool: VariablePool
    user_id: str
    workflow_id: str
    execution_id: str
    
    def get_variable(self, key: str) -> Any:
        """Get variable from pool"""
        return self.variable_pool.get(key)
        
    def set_variable(self, key: str, value: Any) -> None:
        """Set variable in pool"""
        self.variable_pool.set(key, value)
        
    def emit_event(self, event: BaseEvent) -> None:
        """Emit event to engine"""
        self.graph_engine.handle_event(event)
```

### 8. NodeExecutionState

Tracks individual node execution state.

```python
@dataclass
class NodeExecutionState:
    node_id: str
    status: Literal["pending", "running", "completed", "failed", "skipped"]
    start_time: Optional[datetime] = None
    end_time: Optional[datetime] = None
    error: Optional[str] = None
    outputs: Optional[dict[str, Any]] = None
    retry_count: int = 0
    
    def to_dict(self) -> dict[str, Any]:
        """Serialize to dictionary"""
        return {
            "node_id": self.node_id,
            "status": self.status,
            "start_time": self.start_time.isoformat() if self.start_time else None,
            "end_time": self.end_time.isoformat() if self.end_time else None,
            "error": self.error,
            "outputs": self.outputs,
            "retry_count": self.retry_count
        }
```

### 9. Event System Integration

```python
class GraphEngine:
    def handle_event(self, event: BaseEvent) -> None:
        """Handle events from nodes"""
        if isinstance(event, NodeRunStartedEvent):
            self._on_node_started(event)
        elif isinstance(event, NodeRunSucceededEvent):
            self._on_node_succeeded(event)
        elif isinstance(event, NodeRunFailedEvent):
            self._on_node_failed(event)
        
        # Propagate to external listeners
        self._event_emitter.emit(event)
```

### 10. VariablePool

Manages shared variables between nodes.

```python
class VariablePool:
    def __init__(self, initial_vars: Optional[dict[str, Any]] = None):
        self._variables: dict[str, Any] = initial_vars or {}
        self._locks: dict[str, threading.Lock] = defaultdict(threading.Lock)
    
    def get(self, key: str, default: Any = None) -> Any:
        """Thread-safe variable retrieval"""
        with self._locks[key]:
            return self._variables.get(key, default)
    
    def set(self, key: str, value: Any) -> None:
        """Thread-safe variable setting"""
        with self._locks[key]:
            self._variables[key] = value
    
    def to_dict(self) -> dict[str, Any]:
        """Serialize for state persistence"""
        return self._variables.copy()
```

## Example: Graph.from_dict Implementation

Based on the existing workflow structure, here's how Graph.from_dict would parse the data:

```python
@classmethod
def from_dict(cls, data: dict[str, Any]) -> 'Graph':
    """
    Parse workflow data dictionary to create a Graph instance.
    
    Expected format:
    {
        "nodes": [
            {
                "id": "node_123",
                "data": {
                    "type": "llm",
                    "title": "LLM Node",
                    ...node specific config...
                }
            }
        ],
        "edges": [
            {
                "id": "edge_123",
                "source": "node_1",
                "target": "node_2",
                "sourceHandle": "source",
                "targetHandle": "target"
            }
        ]
    }
    """
    nodes = {}
    edges = []
    
    # Parse nodes
    for node_data in data.get("nodes", []):
        node_id = node_data["id"]
        node_type = node_data["data"]["type"]
        
        # Get the appropriate node class based on type
        node_class = NODE_TYPE_MAPPING.get(node_type)
        if not node_class:
            raise ValueError(f"Unknown node type: {node_type}")
        
        # Create node instance
        node = node_class.from_dict(node_data["data"])
        node.node_id = node_id
        nodes[node_id] = node
    
    # Parse edges
    for edge_data in data.get("edges", []):
        edge = Edge(
            source_node_id=edge_data["source"],
            target_node_id=edge_data["target"],
            # Additional edge properties can be added here
        )
        edges.append(edge)
    
    graph = cls(nodes=nodes, edges=edges)
    graph.validate()
    return graph
```

## Detailed Implementation Example

### Queue-Based Scheduling Algorithm

```python
class GraphEngine:
    def __init__(self, graph: Graph, runtime_state: GraphRuntimeState):
        self.graph = graph
        self.runtime_state = runtime_state
        
        # Initialize queues from runtime state
        self.ready_q = deque(runtime_state.ready_nodes)
        self.running_q = set(runtime_state.running_nodes)
        self.completed_q = set(runtime_state.completed_nodes)
        self.failed_q = set(runtime_state.failed_nodes)
        
        # Worker pool
        self.executor = ThreadPoolExecutor(max_workers=10)
        self.futures: Dict[str, Future] = {}
        
    def schedule(self) -> None:
        """Main scheduling loop"""
        while self._has_pending_nodes():
            # Move nodes from completed to ready if preconditions met
            self._update_ready_queue()
            
            # Submit ready nodes to workers
            while self.ready_q and self._has_available_workers():
                node_id = self.ready_q.popleft()
                self._submit_node(node_id)
            
            # Wait for at least one node to complete
            if self.futures:
                done, _ = concurrent.futures.wait(
                    self.futures.values(), 
                    timeout=0.1,
                    return_when=concurrent.futures.FIRST_COMPLETED
                )
                
                for future in done:
                    node_id = self._get_node_id_from_future(future)
                    self._handle_node_completion(node_id, future)
            
            # Checkpoint periodically
            if self._should_checkpoint():
                self._checkpoint()
    
    def _update_ready_queue(self) -> None:
        """Check all nodes and move to ready queue if preconditions met"""
        for node_id in self.graph.nodes:
            if (node_id not in self.ready_q and 
                node_id not in self.running_q and
                node_id not in self.completed_q and
                node_id not in self.failed_q):
                
                node = self.graph.get_node(node_id)
                if self._check_preconditions(node):
                    self.ready_q.append(node_id)
    
    def _check_preconditions(self, node: BaseNode) -> bool:
        """Check if all preconditions are satisfied"""
        for condition in node.preconditions():
            if not condition(self):
                return False
        return True
    
    def _submit_node(self, node_id: str) -> None:
        """Submit node for execution"""
        self.running_q.add(node_id)
        self.runtime_state.node_states[node_id].status = "running"
        self.runtime_state.node_states[node_id].start_time = datetime.now()
        
        future = self.executor.submit(self._execute_node, node_id)
        self.futures[node_id] = future
```

### Node Result Handling

```python
@dataclass
class NodeResult:
    status: Literal["success", "failed", "skipped"]
    outputs: Optional[dict[str, Any]] = None
    error: Optional[Exception] = None
    
class GraphEngine:
    def _execute_node(self, node_id: str) -> NodeResult:
        """Execute a single node"""
        try:
            node = self.graph.get_node(node_id)
            context = self._create_execution_context(node_id)
            
            # Emit start event
            context.emit_event(NodeRunStartedEvent(
                node_id=node_id,
                node_type=node.node_type,
                timestamp=datetime.now()
            ))
            
            # Execute node
            if isinstance(node, ExecutableNode):
                result = asyncio.run(node.execute(context))
            else:
                raise ValueError(f"Node {node_id} is not executable")
            
            # Emit success event
            context.emit_event(NodeRunSucceededEvent(
                node_id=node_id,
                outputs=result.outputs,
                timestamp=datetime.now()
            ))
            
            return result
            
        except Exception as e:
            # Emit failure event
            context.emit_event(NodeRunFailedEvent(
                node_id=node_id,
                error=str(e),
                timestamp=datetime.now()
            ))
            
            return NodeResult(status="failed", error=e)
```

## Next Steps

1. Review and approve specification
2. Create detailed API documentation
3. Set up development environment
4. Begin Phase 1 implementation
5. Create comprehensive test suite