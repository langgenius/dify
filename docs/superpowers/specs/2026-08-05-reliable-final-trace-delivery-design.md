# Reliable Final Trace Delivery Design

## Context

Unified tracing currently has two independent loss windows around Human Input global timeout and provider delivery.

First, global-timeout handling adds a final workflow trace to `TraceQueueManager`'s process-local queue and then deletes the workflow pause snapshot. The queue is flushed to object storage and Celery later, so a process, serialization, storage, or broker failure can lose both the only retained tracing state and the not-yet-persisted trace payload.

Second, `process_trace_tasks` retains its persisted payload only when dispatch raises `RetryableTraceDispatchError` and Celery accepts the retry. Recoverable provider transport failures that surface as ordinary exceptions are treated as terminal and delete the payload.

The runtime therefore needs bounded at-least-once whole-fragment delivery. It may replay a fragment after an ambiguous handoff or partial provider export. It does not provide exactly-once delivery or guarantee eventual provider acceptance after retry exhaustion.

## Goals

- Do not delete a global-timeout pause snapshot until its final trace payload is durable and Celery has accepted the task.
- Recover global-timeout final-trace handoff after process, storage, or broker failures.
- Retry recoverable provider transport failures while retaining the durable payload.
- Bound both handoff and provider retry budgets.
- Preserve workflow and Human Input behavior when tracing fails.

## Non-goals

- Exactly-once provider effects or cross-provider span checkpoints.
- Provider-native deduplication guarantees.
- A new generic outbox table or a migration of every existing trace producer.
- New metrics, Redis failure counters, dashboards, or external alert integrations.

## Workflow pause delivery state

`WorkflowPause` gains two fields:

```text
final_trace_status: null | pending | failed
final_trace_attempts: integer, default 0
```

The fields describe only the reliable handoff of a terminal workflow trace to Celery. They do not replace workflow or Human Input lifecycle status:

- `WorkflowRun` remains `STOPPED` after global timeout.
- `HumanInputForm` remains `EXPIRED`.
- `null` means no final-trace handoff is outstanding.
- `pending` means the final trace has not been durably handed to Celery.
- `failed` means the independent handoff retry budget is exhausted.

Existing rows migrate to `null` and zero, so their behavior is unchanged.

## Global-timeout handoff

The global-timeout database transaction performs only durable domain-state changes:

1. mark the workflow run `STOPPED` and set its terminal error and completion time;
2. mark the workflow pause resumed so the workflow cannot resume again;
3. set `final_trace_status=pending` and `final_trace_attempts=0`.

It does not delete the pause snapshot or enqueue an in-memory trace task.

The existing `human_input_form_timeout.check_and_resume` periodic task adds a recovery pass for pauses whose final trace status is `pending`. For each attempt it atomically increments `final_trace_attempts`, then:

1. loads the retained pause snapshot;
2. restores the provider-neutral Agent fragments and Human Wait records;
3. reads the already-committed terminal workflow run;
4. constructs and serializes the final `TaskData`;
5. overwrites the deterministic object-storage path `ops_trace/<app_id>/workflow-final-<workflow_run_id>.json`;
6. asks the broker to enqueue `process_trace_tasks` with producer-side publish retry enabled.

After broker acknowledgement, the handler conditionally clears `final_trace_status` and deletes the pause snapshot. The durable `ops_trace` payload is then owned by `process_trace_tasks`.

If persistence or enqueueing fails below the retry limit, the status stays `pending` and the next periodic scan repeats the complete idempotent handoff. If the configured limit is reached, the status becomes `failed` and automatic handoff stops. Concurrent or ambiguous attempts may enqueue the same deterministic payload more than once; whole-fragment replay explicitly permits this. Conditional state updates ensure a later failed attempt cannot overwrite a successful handoff.

## Handoff retry budget

A separate configuration controls pre-Celery recovery:

```text
OPS_TRACE_FINAL_TRACE_HANDOFF_MAX_RETRIES=60
```

It must be positive. With the default one-minute Human Input timeout scan interval, the default recovery window is approximately one hour. It is independent of `OPS_TRACE_RETRYABLE_DISPATCH_MAX_RETRIES`, which controls provider delivery after Celery accepts the task.

## Provider delivery

Provider adapters classify failures before they cross the unified tracing boundary:

- connection failures, timeouts, rate limits, server failures, and opaque exporter failure results are retryable;
- invalid credentials, invalid configuration, unsupported contracts, malformed payloads, and invalid parent context are terminal.

Retryable failures raise `RetryableTraceDispatchError`. `process_trace_tasks` retains the payload only after Celery accepts its bounded retry request. A successful provider dispatch deletes the payload. Retry exhaustion and terminal failures record the failure and delete the payload.

A retry always replays the complete canonical fragment in parent-first order. Stable canonical identifiers improve correlation but do not imply that every provider deduplicates repeated effects.

## Cleanup

Pause pruning must exclude `final_trace_status=pending`. A `failed` pause follows the existing resumed-pause retention policy, and its cleanup also removes any deterministic final-trace payload left by a failed broker handoff. Successfully enqueued payloads remain owned by `process_trace_tasks` and are not removed by pause cleanup.

## Logging

No new metrics or alert integration is introduced.

Each failed handoff attempt logs a warning with the event name, workflow run ID, pause ID, attempt number, stage (`persist` or `enqueue`), and exception type. Retry exhaustion logs an error with the same identifiers and total attempts. Logs must not contain the pause snapshot, Human Input contents, credentials, access tokens, or full provider responses.

Provider retry scheduling and exhaustion continue to use the structured logging already owned by `process_trace_tasks`.

## Compatibility and failure isolation

- Existing workflow pauses have no pending final trace and retain their current behavior.
- Normal workflow completion continues through the existing trace queue; this change specifically closes the global-timeout snapshot handoff window.
- Tracing failure never changes the terminal workflow result or reopens a Human Input form.
- The unified tracing ADR must describe bounded at-least-once whole-fragment replay, the pause-snapshot deletion boundary, and the distinction between handoff and provider retry budgets.

## Verification

Tests must cover:

- global timeout commits `STOPPED`, `EXPIRED`, and pending handoff state without deleting the snapshot;
- persistence failure retains pending state and snapshot;
- broker failure retains pending state, snapshot, and deterministic payload;
- successful broker acknowledgement clears pending state and deletes only the snapshot;
- repeated recovery overwrites the deterministic payload and may safely enqueue it again;
- attempt exhaustion records `failed`, stops automatic retries, and logs an error;
- pause pruning skips pending records and cleans failed records plus orphaned deterministic payloads;
- recoverable provider failures retain payloads and request bounded Celery retry;
- terminal provider failures and retry exhaustion delete payloads;
- concurrent success wins over a late failure state update.
