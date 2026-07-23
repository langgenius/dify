# Generate Conversation Name Parent Tracing Design

## Problem

The asynchronous `generate_conversation_name` operation currently loses two pieces of unified tracing context:

1. It does not receive the current message ID or a provider parent context, so it is emitted as an independent root trace.
2. Its `conversation_id` is not used as the canonical session ID, and the LangSmith adapter writes an empty `session_id`, which can prevent LangSmith from falling back to valid conversation metadata when grouping Threads.

## Goals

- Emit title generation as a true child of the current root message span in unified LangSmith and Phoenix traces.
- Group the title operation into the same conversation Thread.
- Reuse the Core Parent Context Coordinator and existing Celery retry mechanism.
- Preserve legacy provider behavior and backwards-compatible method signatures.

## Context propagation

Both Chatflow pipeline variants already hold the current message ID before scheduling title generation. They will pass it through the existing asynchronous path:

```text
Generate pipeline
  -> MessageCycleManager.generate_conversation_name
  -> Timer kwargs
  -> MessageCycleManager._generate_conversation_name_worker
  -> LLMGenerator.generate_conversation_name
  -> TraceTask
  -> GenerateNameTraceInfo
  -> CanonicalTraceBuilder
```

`message_id` remains optional on `MessageCycleManager` and `LLMGenerator` entry points so existing callers continue to work.

`TraceTask` already supports `message_id`, and `GenerateNameTraceInfo` inherits it from `BaseTraceInfo`; no new trace-info field is required.

## Canonical parent contract

The existing `can_parent_workflow` flag is specifically about workflow-tool nodes. It will not be reused for message parenting.

Add these explicit canonical fields:

- `CanonicalSpan.publishes_parent_context: bool = False`
- `CanonicalTrace.required_parent_context_id: str | None = None`

Message root spans created by both workflow and message builders will set `publishes_parent_context=True`.

A generate-name trace with a message ID will have:

- root span `parent_id` equal to the message ID
- `required_parent_context_id` equal to the message ID
- canonical `trace_id` falling back to the message ID through the existing `_single_trace` behavior
- canonical `session_id` equal to `conversation_id`

A generate-name trace without a message ID remains an independent root but still uses `conversation_id` as its session ID.

## Parent context coordination

Add a coordinator operation that resolves a required context directly by canonical parent ID. This path does not need the nested-workflow destination lookup because the message trace and title trace belong to the same app and both resolve their current provider configuration through the same `OpsTraceManager` selection path.

Resolution behavior:

- matching context exists: restore it
- context is absent: raise `PendingTraceParentContextError`
- Redis access fails: raise `TraceParentContextAccessError`
- malformed, wrong-provider, or wrong-scope context: raise `InvalidTraceParentContextError`

The existing Redis namespace and envelope remain unchanged:

```text
trace:unified:parent:{message_id}
```

The existing 300-second context TTL remains unchanged. The title operation starts with the first message and normally consumes the context immediately after the parent trace is exported. Missing context continues to use the shared 300-attempt, five-second Celery retry budget.

## Adapter behavior

Both unified adapters will publish context when either:

- the existing `can_parent_workflow` flag is true, or
- the new `publishes_parent_context` flag is true

LangSmith publishes the created run ID and dotted order. Phoenix publishes the W3C `traceparent`. Publication remains synchronous and occurs only after the provider accepts or finishes the parent span/run.

When the title trace is emitted, the existing restored-parent paths attach it beneath the message run/span.

## Session behavior

`CanonicalTraceBuilder._build_generate_name` will pass `conversation_id` as the single-trace session ID.

The LangSmith adapter will write root `metadata["session_id"]` only when the canonical session ID is non-empty. This prevents an empty unified value from shadowing valid provider-side `conversation_id` fallback behavior for any trace type.

## Failure and compatibility behavior

- Missing message ID: emit a standalone title trace in the correct conversation Thread.
- Missing compatible parent context: retry through the existing provider-agnostic task contract.
- Retry exhaustion: retain current terminal failure behavior; do not fall back to legacy tracing or silently emit a new root.
- Malformed or incompatible context: fail terminally.
- Unified tracing disabled: all legacy provider code paths remain unchanged.
- Existing callers that omit `message_id` remain valid.

## Tests

Focused tests will cover:

1. Both pipelines pass their current message ID into title scheduling.
2. The Timer and worker preserve the optional message ID.
3. `LLMGenerator` places the message ID on the generated `TraceTask`.
4. `OpsTraceManager` preserves the message ID in `GenerateNameTraceInfo`.
5. The canonical title trace uses message parent ID and conversation session ID.
6. A title trace without message ID remains a root but retains the conversation session.
7. Message roots are marked to publish parent context.
8. The coordinator restores required message context and retries when it is pending.
9. LangSmith publishes message context and restores title `parent_run_id`, trace ID, and dotted order.
10. Phoenix publishes message `traceparent` and restores it for the title span.
11. LangSmith omits empty root `session_id` metadata.
12. Existing nested-workflow parent coordination remains unchanged.

## Scope

This change does not alter title generation timing, wait for title generation in the main request, add provider-specific context storage, modify legacy providers, or change Redis context TTL.
