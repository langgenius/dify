# Dify Session ID Semantics

Date: 2026-04-23
Context: Define the correct `session.id` semantics for Phoenix tracing in Dify.

## Goal

Establish a consistent rule for what `session.id` should mean in Dify, across:

- Workflow apps
- Chatflow apps
- Nested workflow calls triggered through workflow tools

## Main Conclusion

`session.id` should follow the top-level user-facing execution container, not the local nested workflow run.

That leads to this rule:

1. Top-level Workflow app
   `session.id = workflow_run_id`
2. Top-level Chatflow app
   `session.id = conversation_id`
3. Nested workflow inside either mode
   inherit the outer session ID instead of redefining it from the nested workflow's own run ID

## Why This Rule Fits Dify

Phoenix sessions are intended to group multiple traces into one logical user session.

In Dify, the natural "session" concept is different by app mode:

- Workflow app: each run is a standalone execution
- Chatflow app: multiple workflow runs belong to one ongoing conversation

So the correct session boundary is mode-dependent.

## Workflow App Semantics

### Expected session meaning

For a workflow app, the session should represent one workflow execution.

Therefore:

- `session.id = workflow_run_id`

### Evidence from the codebase

Workflow responses consistently expose `workflow_run_id` as the main execution identifier.

Relevant code:

- `/Users/yang/.codex/worktrees/ace8/dify/api/core/app/apps/workflow/generate_response_converter.py:47`

Workflow execution is initialized around an explicit generated `workflow_run_id`, which is then stored as the workflow execution identity.

Relevant code:

- `/Users/yang/.codex/worktrees/ace8/dify/api/core/app/apps/workflow/app_generator.py:166`

`WorkflowRun` is the execution record model, and its primary key `id` is the workflow run identity.

Relevant code:

- `/Users/yang/.codex/worktrees/ace8/dify/api/models/workflow.py:737`

### Interpretation

This means a workflow run is the correct outer execution container for workflow mode, and therefore the correct session identity.

## Chatflow Semantics

### Expected session meaning

For chatflow, the session should represent the ongoing conversation rather than a single workflow execution.

Therefore:

- `session.id = conversation_id`

### Evidence from the codebase

Advanced chat responses consistently expose `conversation_id` in both blocking and streaming responses.

Relevant code:

- `/Users/yang/.codex/worktrees/ace8/dify/api/core/app/apps/advanced_chat/generate_response_converter.py:26`
- `/Users/yang/.codex/worktrees/ace8/dify/api/core/app/apps/advanced_chat/generate_response_converter.py:63`

The chatflow run payload schema also treats `conversation_id` as a first-class request field.

Relevant code:

- `/Users/yang/.codex/worktrees/ace8/dify/api/controllers/console/app/workflow.py:117`

Internally, each chatflow message also gets a `workflow_run_id`, but that run ID is attached to the message as the execution for that turn, not the whole conversation.

Relevant code:

- `/Users/yang/.codex/worktrees/ace8/dify/api/core/app/apps/advanced_chat/generate_task_pipeline.py:356`
- `/Users/yang/.codex/worktrees/ace8/dify/api/core/app/apps/advanced_chat/generate_task_pipeline.py:364`

The `Message` model stores both:

- `conversation_id`
- `workflow_run_id`

Relevant code:

- `/Users/yang/.codex/worktrees/ace8/dify/api/models/model.py:1392`
- `/Users/yang/.codex/worktrees/ace8/dify/api/models/model.py:1430`

### Interpretation

This split is important:

- `conversation_id` identifies the multi-turn session
- `workflow_run_id` identifies the single execution for one turn

So in chatflow mode, `conversation_id` is the right Phoenix session key.

## Nested Workflow Semantics

### Core rule

A nested workflow should not redefine the session boundary.

It should inherit the session identity of the outer top-level mode.

That means:

- nested workflow inside top-level workflow app
  inherit outer `workflow_run_id`
- nested workflow inside top-level chatflow
  inherit outer `conversation_id`

### Why

Nested workflows are implementation detail inside a larger user-visible execution.

If each nested workflow used its own `workflow_run_id` as `session.id`, Phoenix sessions would fragment:

- one top-level execution would become many sessions
- the session view would stop matching the user-visible container

## Final Rule

The correct session identity should be determined by the outermost invocation mode:

- outermost mode = workflow
  use `workflow_run_id`
- outermost mode = chatflow
  use `conversation_id`
- nested workflow/tool calls
  inherit outer session identity unchanged

## Practical Tracing Implication

The tracing system should not compute `session.id` from "current local workflow run" in every trace path.

Instead it should carry a resolved session identity from the top-level request context and reuse it throughout:

- root workflow span
- child node spans
- nested workflow spans
- nested workflow child spans

## Working Recommendation

When we re-implement Phoenix session support on `origin/main`, we should introduce a single resolved session identity rule:

- resolve once at the top-level app mode boundary
- propagate it through nested workflows
- apply it consistently to all spans in the same logical session

This will make Phoenix session grouping match Dify's actual product semantics.
