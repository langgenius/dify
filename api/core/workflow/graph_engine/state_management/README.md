# State Management

Thread-safe state tracking for graph execution.

## Components

### NodeStateManager

Manages node states and ready queue.

- `enqueue_node(node_id)` - Mark TAKEN and queue
- `mark_node_skipped(node_id)` - Mark SKIPPED
- `is_node_ready(node_id)` - Check readiness
- Thread-safe with RLock

### EdgeStateManager

Tracks edge satisfaction states.

- `mark_edge_satisfied(edge_id)` - Mark traversed
- `categorize_branch_edges(node_id)` - Group by handle
- Thread-safe with RLock

### ExecutionTracker

Tracks executing nodes.

- `mark_executing/completed(node_id)` - Update state
- `get_executing_count()` - Active count
- Thread-safe with Lock

## Usage

```python
ready_queue = queue.Queue()
node_manager = NodeStateManager(graph, ready_queue)
edge_manager = EdgeStateManager(graph)
execution_tracker = ExecutionTracker()

# Enqueue ready node
if node_manager.is_node_ready("node-1"):
    node_manager.enqueue_node("node-1")
    execution_tracker.mark_executing("node-1")

# Track edge satisfaction
edge_manager.mark_edge_satisfied("edge-1")

# Complete execution
execution_tracker.mark_completed("node-1")
```

## Node States

```text
PENDING → TAKEN → COMPLETED/FAILED
            ↓
         SKIPPED
```

## Thread Safety

- **RLock** - NodeStateManager, EdgeStateManager (reentrant)
- **Lock** - ExecutionTracker (simple exclusion)

All state changes wrapped in lock contexts for atomicity.
