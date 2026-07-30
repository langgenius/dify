# Workflow-as-Tool Trace Parenting Fix

## Problem

When an Agent invokes a Workflow-as-Tool, the child workflow is exported as a
separate root trace instead of being parented beneath the Agent's tool-call
span.

The parent context is successfully published and loaded. The failure happens
inside `AgentToolInnerService`: `ToolEngine.generic_invoke()` returns a lazy
generator, but the workflow runtime's parent trace context is cleared before
that generator is consumed. Consequently, `WorkflowTool._invoke()` starts
without the parent context and emits a root trace.

## Scope

Change only the Workflow-as-Tool invocation lifecycle in
`AgentToolInnerService`. Do not change trace transport, provider contracts,
context serialization, span naming, or non-workflow tools.

## Design

Keep the runtime parent trace context installed for the complete lazy
invocation:

1. Set the parent trace context on the invocation-local workflow runtime.
2. Call `ToolEngine.generic_invoke()`.
3. Consume and transform the returned messages inside the same `try` block.
4. Clear the context in `finally`.

This makes the context available when the generator actually executes while
preserving cleanup on success and on exceptions. The transformed messages are
still materialized exactly once, so the result contract does not change.

Workflow tool runtimes are forked per invocation, which limits the context to
that tool call. Other provider types keep their existing behavior.

## Verification

Add focused tests proving that:

- A lazy workflow tool generator can read the parent context while it is being
  consumed.
- The parent context is cleared after successful consumption.
- The parent context is also cleared when lazy iteration raises.

Run the focused service tests and the existing unified trace regression suite,
then run formatting and lint checks for the modified files.

## Compatibility and Risks

This is an internal lifetime correction with no API, persistence, or event
schema changes. The context remains installed slightly longer—through message
transformation—but only on the invocation-local workflow runtime. Cleanup in
`finally` prevents stale context from surviving either success or failure.
