# Completion Runtime Reuse WorkflowEntry Design

## Summary

Replace the current Completion execution runner with a runtime-only workflow graph executed through `WorkflowEntry`.
The Completion API surface, SSE response format, and Message persistence semantics stay compatible with the current
Completion implementation.

The change is intentionally narrow:

- Completion remains a message-based app.
- `CompletionAppGenerator` continues to create `Conversation`, `Message`, and user `MessageFile` records before the
  worker starts.
- The worker replaces `CompletionAppRunner` with a new runner that builds an in-memory graph and calls
  `WorkflowEntry.run()`.
- GraphOn events are translated back into legacy Completion queue events.
- `EasyUIBasedGenerateTaskPipeline` continues to produce Completion responses and persist the final `Message`.
- No workflow execution persistence is introduced for Completion compatibility.

## Goals

- Reuse Workflow/GraphOn execution logic for Completion.
- Preserve the existing Completion request parameters and validation behavior.
- Preserve the existing Completion SSE and blocking response shapes.
- Preserve existing Completion persistence in `conversations`, `messages`, `message_files`, and existing related file
  tables.
- Delete the old `CompletionAppRunner` after the graph-backed runner reaches parity.

## Non-Goals

- Do not migrate Completion apps into persisted Workflow apps.
- Do not create `Workflow` records for Completion runtime execution.
- Do not create `workflow_runs`, `workflow_node_executions`, `workflow_app_logs`, workflow pause records, HITL records, or
  workflow draft variable records.
- Do not expose `workflow_run_id` or workflow/node SSE events from Completion APIs.
- Do not introduce a generic `DifyGraphEntry` abstraction in this phase.
- Do not change Completion API request or response contracts.

## Current Behavior to Preserve

Completion currently creates message records before execution:

- `Conversation` in `conversations`
- `Message` in `messages`
- user uploaded `MessageFile` records in `message_files`

During execution, the current runner publishes legacy queue events. `EasyUIBasedGenerateTaskPipeline` consumes those
events and owns:

- stream and blocking response conversion
- answer accumulation
- output moderation
- TTS autoplay events
- ping events
- final Message persistence
- error Message persistence
- `message_end.files` assembly
- `message_was_created` and message trace task enqueueing

The graph-backed Completion path must keep this ownership model.

## Architecture

### Components

#### `RuntimeCompletionWorkflowBuilder`

Builds an in-memory graph config from `CompletionAppConfig` and `CompletionAppGenerateEntity`.

The graph is not saved. It exists only for the current run.

Expected graph shape:

```text
start
  -> optional API-based variable nodes
  -> optional knowledge retrieval node
  -> llm node
  -> end node
```

API-based variables are the existing Completion `external_data_tools` / API-based Variable feature. They are represented
with workflow HTTP request and code nodes only to preserve the old behavior inside the graph runtime.

The builder should reuse the existing conversion logic from `WorkflowConverter` where possible, but the reusable part must
not create a `Workflow` database record.

#### `CompletionWorkflowRunner`

Replaces `CompletionAppRunner`.

Responsibilities:

- run the same Completion preflight behavior that belongs before model execution, including input moderation and hosted
  model moderation checks
- build the runtime-only graph
- initialize `VariablePool` and `GraphRuntimeState`
- initialize the graph with Dify node factory context
- create `WorkflowEntry`
- use a Redis command channel keyed by the Completion task id so stop commands can reach GraphEngine
- call `WorkflowEntry.run()`
- translate GraphOn events into legacy Completion queue events

The runner must not call `WorkflowAppRunner`, because that runner attaches workflow-specific persistence and response
semantics.

#### `CompletionGraphEventAdapter`

Consumes `WorkflowEntry.run()` events and publishes legacy queue events to `MessageBasedAppQueueManager`.

Primary mapping:

| GraphOn event | Legacy Completion queue event |
| --- | --- |
| `NodeRunStreamChunkEvent` | `QueueLLMChunkEvent` |
| `NodeRunRetrieverResourceEvent` | `QueueRetrieverResourcesEvent` |
| `GraphRunSucceededEvent` | `QueueMessageEndEvent` |
| `GraphRunFailedEvent` | `QueueErrorEvent` |
| `GraphRunAbortedEvent` caused by user stop | `QueueStopEvent(stopped_by=USER_MANUAL)` |
| other `GraphRunAbortedEvent` | `QueueErrorEvent` |
| node failure / exception | `QueueErrorEvent` |

The adapter must collect enough LLM result state to publish a `QueueMessageEndEvent(llm_result=...)` compatible with
`EasyUIBasedGenerateTaskPipeline`.

The adapter must not publish workflow queue events such as `QueueWorkflowStartedEvent`, `QueueNodeStartedEvent`, or
`QueueWorkflowSucceededEvent` to the Completion pipeline.

#### Existing `EasyUIBasedGenerateTaskPipeline`

The pipeline remains the owner of Completion presentation and Message persistence for this compatibility phase.

It continues to:

- emit `message`, `message_end`, `message_file`, `message_replace`, `tts_message`, `tts_message_end`, `error`, and `ping`
  events
- build blocking Completion responses
- run output moderation before final save
- update `messages`
- handle error persistence

No new Completion graph persistence layer is needed in this phase.

## Data Flow

1. Completion API receives the existing request shape.
2. `CompletionAppGenerator.generate()` validates request arguments and builds `CompletionAppGenerateEntity`.
3. `_init_generate_records()` creates the old `Conversation`, `Message`, and user `MessageFile` records.
4. The worker creates `CompletionWorkflowRunner`.
5. `CompletionWorkflowRunner` builds a runtime-only graph from the Completion app config.
6. `CompletionWorkflowRunner` runs the graph through `WorkflowEntry.run()`.
7. `CompletionGraphEventAdapter` converts GraphOn events into legacy Completion queue events.
8. `EasyUIBasedGenerateTaskPipeline` consumes the legacy queue events.
9. The client receives the same Completion SSE or blocking response as before.
10. `EasyUIBasedGenerateTaskPipeline` saves the final `Message` exactly as the old Completion path did.

## Persistence

### Preserved

Initial records still come from `MessageBasedAppGenerator._init_generate_records()`:

- `Conversation`
- `Message`
- user `MessageFile`

Final updates still come from `EasyUIBasedGenerateTaskPipeline`:

- saved prompt in `Message.message`
- final answer in `Message.answer`
- token usage and pricing fields
- provider latency
- currency and total price
- `message_metadata`
- assistant `MessageFile` records when generated files exist
- error status and error text on failure

### Not Persisted

The graph-backed Completion path must not write:

- `Workflow`
- `WorkflowRun`
- `WorkflowNodeExecutionModel`
- `WorkflowAppLog`
- `WorkflowPause`
- `WorkflowPauseReason`
- HITL forms
- workflow draft variable records
- workflow node output offload records

## Output Moderation

Completion keeps the current Message-based moderation behavior.

The key rule is that the final persisted answer is whatever `EasyUIBasedGenerateTaskPipeline` has in its task state after
output moderation runs. This mirrors the existing Completion path and the Advanced Chat Message persistence pattern.

The graph adapter should publish text chunks normally. It should not persist raw graph output. Final moderation remains in
the pipeline before `_save_message()`, so the persisted `messages.answer` matches the moderated response returned to the
client.

## Stop Behavior

Completion stop APIs must keep their existing external contract.

Internally, graph-backed Completion should support both mechanisms:

- existing Redis stop flag used by legacy message-based tasks
- GraphEngine stop command through the WorkflowEntry command channel

`AppTaskService.stop_task()` should send a GraphEngine stop command for graph-backed Completion tasks once this runner is
enabled. The queue listener still receives a legacy stop event so the Completion pipeline can save partial state and return
the old response shape.

Output moderation can also stop the message pipeline internally with `QueueStopEvent(OUTPUT_MODERATION)`. That remains a
pipeline concern and does not require workflow persistence.

## Error Handling

Graph-level and node-level failures are converted into `QueueErrorEvent`.

`EasyUIBasedGenerateTaskPipeline` remains responsible for converting the error into Completion `error` SSE output and
updating `Message.status` / `Message.error`.

Unknown `WorkflowEntry` exceptions already become `GraphRunFailedEvent`; the adapter should treat them the same as other
graph failures.

## Compatibility Requirements

The new path must preserve:

- Completion request parameter behavior
- Completion blocking response format
- Completion streaming response events and fields
- final `message_id`
- `message_end.metadata`
- retriever resource metadata behavior
- output moderation replacement behavior
- TTS autoplay behavior
- stop task behavior
- error response and error persistence behavior

## Testing Plan

Add focused tests around the compatibility boundary:

- runtime graph builder does not create a `Workflow` record
- graph-backed Completion run does not create workflow persistence rows
- stream chunks map to `message` SSE
- final graph success maps to `message_end`
- blocking response shape matches current Completion
- Message persistence updates the same fields as current Completion
- retriever resources appear in `message_metadata` when enabled
- output moderation replacement is returned and persisted
- stop task produces old Completion stop behavior and persists partial answer
- graph failure returns old Completion error response and marks the Message as error
- API-based Variable is preserved through runtime HTTP/code nodes

## Open Implementation Notes

- The implementation must identify the stable source of prompt messages and usage from GraphOn LLM node results before
  constructing `LLMResult` for `QueueMessageEndEvent`.
- The runtime graph builder should extract pure graph construction logic from `WorkflowConverter` instead of duplicating
  conversion rules.
- The old `CompletionAppRunner` should be deleted only after parity tests pass.
