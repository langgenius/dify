# Graph Traversal

Graph navigation and node readiness logic.

## Components

### EdgeProcessor

Processes edges after node completion.

- `process_node_success(node_id, selected_handle)` - Process edges

### NodeReadinessChecker

Determines node execution readiness.

- `is_node_ready(node_id)` - Check if ready

### BranchHandler

Manages branch node logic.

- `handle_branch_completion(node_id, selected_handle)` - Process branch

### SkipPropagator

Propagates skip status downstream.

- `propagate_skip(node_id)` - Skip node and dependents

## Usage

```python
# Process node completion
edge_processor.process_node_success(
    node_id="branch-node",
    selected_handle="true-branch"
)

# Check readiness
if readiness_checker.is_node_ready("node-2"):
    execute_node("node-2")

# Propagate skip
skip_propagator.propagate_skip("skipped-node")
```

## Node Readiness

A node is ready when:

1. All incoming edges satisfied
2. Parallel constraints met
3. Not in skip state
4. Supported node type

## Branch Processing

- Edges grouped by source_handle
- Selected handle determines taken edges
- Unselected edges marked as skipped
