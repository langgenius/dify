# Workflow Stop Status Investigation

## Context

The console debug stop endpoint for advanced chat/chatflow apps is:

```text
POST /console/api/apps/{app_id}/chat-messages/{task_id}/stop
```

It was expected to stop a running workflow and update the console/debug workflow run status from `running` to a terminal state. Testing showed that after pressing **Stop**, the debug workflow run could remain `running` indefinitely.

A temporary diagnostic marker was added to both Dify and Graphon logs to trace the stop path:

```text
WF_STOP_DIAG_7B9C2F
```

## Stop Path

For an advanced-chat app, the console stop API currently does two things:

1. Set the legacy Dify stop flag:

```python
AppQueueManager.set_stop_flag(task_id, invoke_from, user_id)
```

2. Send a GraphEngine abort command:

```python
GraphEngineManager(redis_client).send_stop_command(task_id)
```

The GraphEngine command is written to Redis under:

```text
workflow:{task_id}:commands
workflow:{task_id}:commands:pending
```

The workflow run is persisted as `stopped` only when Graphon emits `GraphRunAbortedEvent` and Dify's `WorkflowPersistenceLayer` handles it.

## Terminal Event Lifecycle

`GraphRunAbortedEvent` is not emitted directly by the command handler. The normal lifecycle is:

```text
Redis AbortCommand
→ CommandProcessor.fetch_commands()
→ AbortCommandHandler.handle()
→ GraphExecution.abort()
→ graph_execution.aborted = True
→ Dispatcher exits and marks the event manager complete
→ GraphEngine.run() finishes yielding buffered node events
→ GraphEngine._emit_terminal_events()
→ GraphRunAbortedEvent
→ WorkflowPersistenceLayer._handle_graph_run_aborted()
→ workflow_runs.status = stopped
```

This means the GraphEngine generator must continue running until `_emit_terminal_events()` is reached. If Dify interrupts the generator before then, the persistence layer will not receive `GraphRunAbortedEvent`, and the workflow run can remain `running`.

## Findings from Logs

The stop API successfully set the legacy stop flag and sent the GraphEngine command:

```text
set_stop_flag_success task_id=...
graphon_redis_send_command key=workflow:{task_id}:commands command=AbortCommand
graphon_redis_send_done key=workflow:{task_id}:commands
```

On the worker side, before Stop was clicked, Graphon periodically fetched commands during idle queue periods and found no pending command:

```text
graphon_dispatcher_queue_empty_process_commands
graphon_redis_fetch_enter key=workflow:{task_id}:commands
graphon_redis_pending_check ... pending=False
```

After Stop was clicked, the workflow was inside an LLM streaming node. The dispatcher received many stream chunk events:

```text
graphon_dispatcher_event_received event=NodeRunStreamChunkEvent
graphon_dispatcher_process_commands_check event=NodeRunStreamChunkEvent should_process=False
```

The original command trigger set did not include `NodeRunStreamChunkEvent`:

```python
_COMMAND_TRIGGER_EVENTS = (
    NodeRunSucceededEvent,
    NodeRunFailedEvent,
    NodeRunExceptionEvent,
    NodeRunModelPollingProgressEvent,
)
```

Therefore, while stream chunks were flowing, the dispatcher did not fetch the Redis abort command. Because chunks were frequent, the dispatcher also did not enter the queue-empty branch where it would otherwise poll commands.

## Why Waiting for Final Node Events Was Not Reliable

In pure Graphon execution, the LLM node should eventually emit a terminal node event such as `NodeRunSucceededEvent`, after which the dispatcher would fetch commands.

In Dify's current integration, the legacy stop flag can interfere first. Queue managers check the legacy flag while publishing application-manager events:

```python
if pub_from == PublishFrom.APPLICATION_MANAGER and self._is_stopped():
    raise GenerateTaskStoppedError()
```

That exception is caught and swallowed by the advanced-chat generator:

```python
try:
    runner.run()
except GenerateTaskStoppedError:
    pass
```

This can interrupt the GraphEngine generator before Graphon reaches terminal event emission. In that case, `GraphRunAbortedEvent` is never emitted and the workflow run remains `running`.

The legacy stop check also uses a short local TTL cache, so it may not trigger on the first chunk immediately after Stop. This explains why logs can still show several chunk publishes after the stop flag is set.

## Quick Validation Fix

For rapid validation, `NodeRunStreamChunkEvent` was added to Graphon's command trigger events:

```python
_COMMAND_TRIGGER_EVENTS = (
    NodeRunSucceededEvent,
    NodeRunFailedEvent,
    NodeRunExceptionEvent,
    NodeRunModelPollingProgressEvent,
    NodeRunStreamChunkEvent,
)
```

A focused test confirmed that stream chunk events now call `process_commands()`.

After this change, a new console debug run for app/chatflow `333` with query `888` produced a workflow run with status:

```text
status = stopped
```

## Current Root Cause Summary

The indefinite `running` status was caused by the interaction of two stop mechanisms:

1. Graphon did not poll Redis commands while continuously processing `NodeRunStreamChunkEvent` events.
2. Dify's legacy stop flag could interrupt the GraphEngine generator before Graphon emitted terminal events.

As a result, the Redis `AbortCommand` could remain unconsumed, and `WorkflowPersistenceLayer` would never receive `GraphRunAbortedEvent`.

## Recommended Long-Term Direction

A robust fix should address both sides:

1. **Graphon**: poll commands during streaming in a controlled way.
   - The quick fix polls after every `NodeRunStreamChunkEvent`.
   - A more production-friendly version may use time-based throttling to avoid Redis checks for every token.

2. **Dify**: prevent the legacy stop flag from interrupting GraphEngine-backed lifecycles.
   - For advanced-chat/workflow modes, execution stop should be owned by GraphEngine commands.
   - The legacy flag should not raise `GenerateTaskStoppedError` in a way that closes the GraphEngine generator before terminal events.
   - If Dify still needs to close the client response immediately, that should be separated from execution cancellation, for example with distinct response-level and execution-level stop semantics.

3. **Fallback safety**: consider a Dify-side compensation path only as a fallback.
   - If `GenerateTaskStoppedError` still occurs for a GraphEngine-backed run, Dify may mark the active workflow run stopped idempotently.
   - This should not replace the normal Graphon terminal event lifecycle.

## Temporary Commits Created During Investigation

Dify:

```text
3403d8325d tmp: add workflow stop diagnostic logs
```

Graphon:

```text
a667ea4 tmp: add workflow stop command diagnostics
d34b200 tmp: restore ModelType value_of compatibility
304d9c5 tmp: poll commands after stream chunks
```

These commits were intentionally marked `tmp` to make them easy to revert or squash later.
