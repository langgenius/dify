# Service API Trace Session ID Design

## Summary

Add an optional `trace_session_id` argument to Dify Service API generation requests. The value overrides the
OpenInference `session.id` span attribute exported by the Arize/Phoenix tracing provider. It is an observability-only
identifier and must not change Dify conversation state, workflow run identity, OpenTelemetry trace identity, or span
parent-child relationships.

This design accepts `trace_session_id` from explicit Service API request inputs: HTTP header, query parameter, and JSON
body. It does not read W3C `baggage`, OpenTelemetry context, or `traceparent`.

For the existing `trace_id` behavior that this feature should align with where appropriate, see
[Existing Trace ID Alignment Reference](./2026-06-03-trace-id-alignment-reference.md).

## Language

`trace_session_id` is a caller-provided observability identifier that groups Service API generation traces under the
caller's logical session. It is distinct from Dify `conversation_id`, `workflow_run_id`, `message_id`, Dify `trace_id`,
and OpenTelemetry trace/span IDs.

Only the initial authenticated Service API generation request may introduce a new `trace_session_id`. Supported request
inputs are `X-Trace-Session-Id`, `trace_session_id` query parameter, and `trace_session_id` JSON body field.

## Problem

Enterprise users often invoke Dify through the Service API while their own application already has a logical session,
tenant journey, or request grouping identifier. Phoenix and other OpenInference-compatible backends group traces with
the `session.id` semantic attribute, but Dify currently derives that value from Dify-owned identifiers such as
`conversation_id`, parent workflow context, or `workflow_run_id`.

That makes it difficult for callers to align Dify traces with the external system's existing session view. The caller
needs a way to provide a tracing session ID without creating, resuming, or mutating a Dify conversation.

## Goals

- Allow Service API callers to provide an optional `trace_session_id` through an HTTP header, query parameter, or JSON
  request body.
- Use `trace_session_id` as the preferred value for OpenInference `session.id` in Arize/Phoenix spans.
- Preserve current behavior when `trace_session_id` is absent.
- Keep the value scoped to observability metadata.
- Support Service API app generation paths, including chat, completion, workflow, and advanced chat where applicable.
- Keep streaming workflow execution and HITL pause/resume compatible with Celery payload and resumption-state
  serialization.

## Non-Goals

- Do not read or write W3C `baggage`.
- Do not read the current OpenTelemetry context for session grouping.
- Do not interpret `traceparent` as a session identifier.
- Do not change `conversation_id`, `workflow_run_id`, `message_id`, Dify `trace_id`, or OpenTelemetry trace/span IDs.
- Do not alter Phoenix span hierarchy or nested workflow parent resolution.
- Do not change non-Arize/Phoenix tracing provider session or trace semantics.
- Do not add or enqueue additional message traces from app generation pipelines. `trace_session_id` support must not
  increase the number of exported traces, but existing message trace tasks should carry the custom session metadata when
  they are already emitted.
- Do not add UI controls in Console or Web App.
- Do not support Console, Web App, or OpenAPI-originated generation requests as public `trace_session_id` input sources.
- Do not support non-generation Service API endpoints such as stop task, workflow run detail, or log listing endpoints.
- Do not accept `trace_session_id` from HITL form submissions, resume requests, workflow node inputs, or end-user form
  data.

## API Contract

Service API generation endpoints may include `trace_session_id` in the `X-Trace-Session-Id` HTTP header:

```text
X-Trace-Session-Id: enterprise-session-123
```

They may also include it as a query parameter:

```text
POST /v1/chat-messages?trace_session_id=enterprise-session-123
```

They may also include it in the JSON body:

```json
{
  "inputs": {},
  "query": "What happened in my last order?",
  "response_mode": "streaming",
  "user": "enterprise-user-1",
  "trace_session_id": "enterprise-session-123"
}
```

When multiple explicit inputs are present, resolve them with this priority:

```text
X-Trace-Session-Id header
  > trace_session_id query parameter
  > trace_session_id JSON body field
  > existing provider fallback
```

Naming follows the existing `trace_id` public input shape: the HTTP header uses `X-Trace-Session-Id`, while query
parameter and JSON body inputs use snake_case `trace_session_id`. Do not add camelCase or kebab-case aliases.

Recommended validation:

- Type: string.
- Effective only after trimming surrounding whitespace.
- Store and propagate the trimmed value.
- Length: 1 to 200 characters after trimming.
- No character allowlist. Unlike `trace_id`, `trace_session_id` is not limited to letters, numbers, hyphen, and
  underscore.
- If the field is absent, preserve existing behavior.
- Validate only the highest-priority resolved input. Lower-priority values are ignored even if they are invalid.
- A present higher-priority input that trims to an empty string is invalid and must not fall back to lower-priority
  inputs.
- If the resolved input is present but invalid, return the endpoint's standard invalid-argument response with the field
  name and reason, such as the 1-200 character length requirement. Do not echo the original value.
- Unlike the existing `trace_id` helper, invalid `trace_session_id` values are not silently ignored.

The value is not returned in generation API responses or SSE event payloads. It may be exported as internal trace
metadata by tracing providers, but the implementation should not add new application log fields for it.

## Data Flow

1. Service API controller parses the JSON request body and reads explicit request-level `trace_session_id` inputs.
2. If a resolved `trace_session_id` is valid, the controller stores the trimmed value in `args["trace_session_id"]`.
3. App generators extract `trace_session_id` from `args` into `application_generate_entity.extras` or an equivalent
   runtime propagation field for every target generation path.
4. Workflow trace task enqueueing copies the value into workflow trace metadata. Existing message trace task enqueueing
   also copies the value into message trace metadata when that task is already emitted by the current app path.
5. `WorkflowTraceInfo` and existing `MessageTraceInfo` exports carry the value through
   `metadata["trace_session_id"]`.
6. `arize_phoenix_trace` resolves OpenInference session ID with this priority:

```text
metadata.trace_session_id
  > existing workflow/message fallback
```

The existing workflow fallback remains:

```text
conversation_id
  > parent workflow run id
  > workflow_run_id
```

If an existing message trace is produced, its fallback remains:

```text
message_data.conversation_id
```

## Phoenix Provider Behavior

The normalized `trace_session_id` propagation path should be available on workflow trace metadata and on existing
message trace metadata when a message trace is already emitted. In this version, only the Arize/Phoenix provider changes
its export semantics by mapping that metadata value to OpenInference `session.id`. Other tracing providers may continue
exporting metadata as they already do, but should not receive provider-specific trace/session behavior changes for this
feature.

The Arize/Phoenix provider should centralize session resolution so workflow spans, wrapper spans, node spans, and
existing message/LLM spans use the same custom session value when their trace metadata contains `trace_session_id`.

Service API generation pipelines must not add new `MESSAGE_TRACE` enqueueing for this feature. The custom session ID is
for Phoenix session grouping, not for creating additional message-level traces. If an app path already emits
`MESSAGE_TRACE`, that existing task should carry `trace_session_id` metadata so plain chat/completion traces can also be
grouped by the caller-provided session.

When a workflow invokes a nested workflow as part of the same Service API generation request, the nested workflow trace
should inherit the same resolved `trace_session_id`. This inheritance must not change nested workflow trace identity,
root trace selection, or parent-child span relationships.

For nested workflow invocations, the parent workflow runtime's inherited `trace_session_id` takes priority over any
different `trace_session_id` that may appear in the nested workflow invocation args.

For workflow traces:

```python
session_id = resolve_trace_session_id(trace_info)
attributes[SpanAttributes.SESSION_ID] = session_id or ""
```

For existing message traces:

```python
session_id = resolve_trace_session_id(trace_info)
attributes[SpanAttributes.SESSION_ID] = session_id or ""
```

The resolver should read `trace_info.metadata["trace_session_id"]` first. If absent, it should preserve today's
provider-specific fallback behavior.

When `trace_session_id` is present, Arize/Phoenix spans should keep it in exported span metadata in addition to setting
OpenInference `session.id`.

No special handling is needed when `trace_session_id` has the same string value as a Dify `conversation_id`,
`workflow_run_id`, or `message_id`; the values may match while the concepts remain distinct.

## Persistence Boundary

`trace_session_id` is not Dify business state and should not be written to `WorkflowRun`, `Message`, workflow execution
metadata, message metadata, or normal API/SSE responses.

For paused workflow executions, the value must remain available across HITL pause/resume by being preserved in the
serialized generate entity or equivalent workflow resumption state. This mirrors the existing `external_trace_id`
runtime propagation shape: the value is not a business record field, but it must survive the persisted pause state so
the resumed execution continues exporting the same OpenInference `session.id`.

HITL resume requests must not override the original generation request's `trace_session_id`. Resume continues the same
workflow run and should use the value preserved in the workflow resumption state.

Only the initial authenticated Service API generation request may introduce a new `trace_session_id`. HITL form
submissions, resume requests, workflow node inputs, and end-user form data are not trusted sources for this value.

## Why Not `traceparent`

`traceparent` is part of W3C Trace Context. It carries distributed tracing identity: version, trace ID, parent span ID,
and trace flags. It is designed to preserve causal trace structure across service boundaries.

Using `traceparent` for this feature would mix two different concepts:

- `traceparent.trace_id`: identifies a distributed trace.
- OpenInference `session.id`: groups related LLM interactions into a logical user or application session.

The issue explicitly requires the custom value to not change trace IDs or span parent-child relationships. Reusing
`traceparent` would make that boundary unclear and could accidentally affect distributed tracing semantics. Therefore,
`traceparent` remains reserved for trace context propagation and is not used as a session override.

This differs from Dify's existing public `trace_id`, which may use `traceparent` as a trace identity fallback. That
fallback remains valid for trace identity, but it is not part of `trace_session_id` resolution.

## Why Not `baggage`

W3C/OTel `baggage` can propagate arbitrary key-value pairs through context. It is useful when a value must flow
automatically across service boundaries and be available to downstream instrumentation.

This feature does not require that behavior. Dify already has an explicit request-to-task data path for Service API
generation, including Celery payload serialization for streaming workflow execution. Passing the value through
`args` and trace metadata is more direct, easier to validate, easier to test, and does not depend on ambient
OpenTelemetry context.

Avoiding `baggage` also avoids these concerns in the first version:

- Dify's current global OTel propagator setup does not include W3C baggage propagation.
- Baggage may be injected into downstream instrumented HTTP calls when propagation is enabled.
- Baggage values are not span attributes unless code explicitly copies them.
- Incoming baggage is not integrity-protected and should not be treated as a trusted application contract.

The public API contract should therefore be explicit Service API request inputs. A future version may optionally accept
`baggage` as an additional input source, but it should still normalize the value into the same internal
`trace_session_id` metadata field and preserve the distinction between session grouping and trace identity.

## Compatibility

This change is backwards-compatible:

- Existing requests without `trace_session_id` keep current tracing behavior.
- Existing conversation and workflow APIs keep their semantics.
- Existing Phoenix grouping by Dify conversation or workflow identifiers remains the fallback.
- Existing message trace task creation behavior is preserved; Service API generation with `trace_session_id` must not
  enqueue extra message traces or change response/SSE metadata. Existing message traces may have their exported
  OpenInference `session.id` changed to the custom session value.
- Existing `trace_id`, `X-Trace-Id`, OpenTelemetry context, and `traceparent` behavior for trace identity is unchanged.
- No database migration is required.
- No frontend behavior changes are required.

## Documentation

Service API documentation should describe `trace_session_id` for target generation endpoints, including
`X-Trace-Session-Id`, `trace_session_id` query parameter, `trace_session_id` JSON body field, and the
header > query parameter > JSON body priority. Documentation placement and style should follow the existing public
`trace_id` documentation pattern.

## Testing

Add focused tests for:

- Service API request parsing accepts valid `trace_session_id` from `X-Trace-Session-Id`, query parameter, and JSON body.
- Service API request parsing resolves `trace_session_id` with header > query parameter > JSON body priority.
- Service API request parsing ignores invalid lower-priority `trace_session_id` values when a higher-priority value is
  valid.
- Service API request parsing rejects a present higher-priority `trace_session_id` that trims to an empty string instead
  of falling back to lower-priority values.
- Missing `trace_session_id` does not alter current behavior.
- Invalid `trace_session_id` returns the endpoint's standard invalid-argument response.
- Workflow generator extras include `trace_session_id`.
- Streaming workflow Celery payload preserves `args["trace_session_id"]` until the generate entity is built.
- HITL pause/resume preserves `trace_session_id` in workflow resumption state and uses it after resume.
- HITL resume ignores any new request-level `trace_session_id` and continues using the original preserved value.
- Service API documentation covers header, query parameter, JSON body input, and priority order for target generation
  endpoints.
- Phoenix workflow trace uses `metadata["trace_session_id"]` for root workflow, workflow, wrapper, and node spans.
- App generation pipelines do not add new `MESSAGE_TRACE` enqueueing when saving messages, even when a trace manager and
  `trace_session_id` are present.
- Existing Phoenix message trace exports keep their fallback behavior when `metadata["trace_session_id"]` is absent, and
  use the metadata value when such a trace is already produced by the app path.
- Nested workflow traces inherit the parent request's `trace_session_id` while preserving existing parent-child span
  relationships.
- Nested workflow traces prefer the parent workflow runtime's inherited `trace_session_id` over any different nested
  invocation arg value.
- Existing fallback tests still pass when the custom value is absent.

## Implementation Notes

- Decision note: keep `trace_session_id` on explicit Service API inputs and trace metadata. Do not derive it from
  `traceparent`, W3C baggage, OpenTelemetry context, or Dify business records because it is session grouping metadata,
  not trace identity or business state.
- Completion/chat non-workflow message save paths must not add message trace enqueueing solely for this feature. Keep the
  `trace_session_id` propagation in generate entity extras so existing message trace tasks can use the custom Phoenix
  session, but do not use that as a reason to create additional message-level Phoenix traces.
- If a target generation path does not already pass request metadata to provider trace info, add the smallest compatible
  propagation path rather than changing provider trace entity contracts broadly.
