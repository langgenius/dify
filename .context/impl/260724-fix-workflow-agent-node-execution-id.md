# Fix Workflow Agent Node Execution ID

## Origin

A Workflow Agent node passed the graph node ID through fields named
`node_execution_id`. The participant session store then used that value to query
the UUID primary key of `workflow_node_executions`, causing PostgreSQL to reject
timestamp-shaped graph node IDs as invalid UUIDs.

## Implementation

- Changed both Workflow Agent execution-identity call sites from `self.id` to
  `self.execution_id`:
  - the `WorkflowAgentSessionScope` passed to participant persistence;
  - the `WorkflowAgentRuntimeBuildContext` passed to the Agent backend request
    builder.
- Added a focused regression test that gives the node distinct graph-node and
  execution identities, then verifies both call paths receive the execution UUID
  while their `node_id` fields continue to receive the graph node ID.
- Extended the existing test helper only enough to expose the runtime request
  builder and the Graphon execution state required by `ensure_execution_id()`.

## Difference From the Origin Task

The implementation stays within the diagnosed fix. It adds no schema changes,
fallbacks, compatibility handling, lifecycle changes, or new abstractions.
Production code changes are limited to the two incorrect attribute references;
the remaining diff is the regression test and its minimal test wiring.

## Verification

- Focused regression test: 1 passed.
- Agent v2 node test module: 23 passed.
- Ruff format and Ruff check passed for the touched files.
- `git diff --check` passed.
- All five `$cmd-impl` review stages passed.
