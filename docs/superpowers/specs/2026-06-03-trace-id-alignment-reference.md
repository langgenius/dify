# Existing Trace ID Alignment Reference

This note records how Dify's existing public `trace_id` feature works so the `trace_session_id` implementation can
match the relevant propagation shape while preserving the semantic boundary between trace identity and session grouping.

## Concept

`trace_id` is the public request field. Internally, Dify normalizes it to `external_trace_id` and eventually stores it on
trace entities as `BaseTraceInfo.trace_id`.

It is a trace identity or correlation override for observability providers. It is not a Dify conversation identifier and
not an OpenInference `session.id`.

The existing internal path is:

```text
request.trace_id / X-Trace-Id
  -> args["external_trace_id"]
  -> application_generate_entity.extras["external_trace_id"]
  -> TraceTask(..., external_trace_id=...)
  -> BaseTraceInfo.trace_id
  -> provider-specific trace export
```

## Public Inputs

`get_external_trace_id(request)` reads the value with this priority:

```text
X-Trace-Id header
  > trace_id query parameter
  > trace_id JSON body field
  > current OpenTelemetry context
  > traceparent header trace_id
```

The value is valid only when it is 1 to 128 characters and contains letters, numbers, hyphen, or underscore. Invalid
values are ignored by returning `None`.

## Entry Point Pattern

Service API controllers parse the request payload, read the external trace ID, and write it into `args`:

```python
external_trace_id = get_external_trace_id(request)
args = payload.model_dump(exclude_none=True)
if external_trace_id:
    args["external_trace_id"] = external_trace_id
```

Current Service API generation endpoints call this helper for chat, completion, workflow, and workflow-by-id requests.
Console generation endpoints also have similar reading logic, but that does not imply every new observability argument
must support Console input.

## Generator Propagation Pattern

Workflow and advanced chat generators copy the normalized value from `args` into entity extras:

```python
extras = {
    **extract_external_trace_id_from_args(args),
}
```

Advanced chat merges it with conversation-name behavior:

```python
extras = {
    "auto_generate_conversation_name": args.get("auto_generate_name", False),
    **extract_external_trace_id_from_args(args),
}
```

Plain chat and completion have historically had weaker propagation coverage than workflow paths. A new
`trace_session_id` implementation should not copy that gap. It should explicitly propagate through every target
generation path named in its API contract.

## Trace Task And Entity Behavior

`TraceTask` reads `external_trace_id` from keyword arguments and assigns `self.trace_id`:

```python
external_trace_id = kwargs.get("external_trace_id")
if external_trace_id:
    self.trace_id = external_trace_id
```

It then passes `trace_id=self.trace_id` when constructing trace info objects such as `WorkflowTraceInfo` and
`MessageTraceInfo`.

`BaseTraceInfo.resolved_trace_id` resolves trace identity with this priority:

```text
BaseTraceInfo.trace_id
  > workflow_run_id
  > message_id
```

`trace_session_id` must not be added to this resolver because it is not a trace identity.

## Phoenix Session Behavior

The Arize/Phoenix provider currently resolves workflow OpenInference `session.id` with:

```text
conversation_id
  > parent workflow run id
  > workflow_run_id
```

Message traces currently use:

```text
message_data.conversation_id
```

For `trace_session_id`, the provider should add a session resolver with:

```text
metadata.trace_session_id
  > existing workflow/message fallback
```

Workflow spans, wrapper spans, node spans, message spans, and LLM child spans should use the same resolved value for a
single trace export.

## Documentation Coverage

The front-end API documentation templates already document `trace_id` for chat, advanced chat, and workflow templates,
including header, query parameter, and request body inputs.

The completion template currently does not document `trace_id`. The generated `api/openapi/markdown/service-swagger.md`
also does not list `trace_id` or `X-Trace-Id`.

## History

The initial feature was introduced by:

```text
841e53dbbe57209fe73838c3cd8580c91bee9dc1
2025-07-22 15:17:43 +0800
qfl
feat(trace): support external trace id propagation (#22623)
```

That commit added the helper, Service API reading for chat and workflow paths, provider propagation, tests, and
front-end documentation templates.

Relevant follow-up commits:

```text
00cb1c26a1472d2512173453fef8a7f6669c35de
2025-07-29
refactor: pass external_trace_id to message trace (#23089)
```

This added completion endpoint reading and passed `trace_id` into message-oriented trace info.

```text
aa71173dbb7670146a188711ee0d1d087656bdb4
2025-08-15
Feat: External_trace_id compatible with OpenTelemetry (#23918)
```

This added fallback support for the current OpenTelemetry context and `traceparent`.

## Trace Session ID Alignment

`trace_session_id` should align with `trace_id` by using an explicit request-to-args-to-extras-to-trace-data path:

```text
request X-Trace-Session-Id / query.trace_session_id / JSON body.trace_session_id
  -> args["trace_session_id"]
  -> application_generate_entity.extras["trace_session_id"]
  -> workflow trace task kwargs or existing message trace task kwargs
  -> WorkflowTraceInfo.metadata["trace_session_id"]
  -> MessageTraceInfo.metadata["trace_session_id"] when an existing message trace is emitted
  -> Phoenix session resolver
  -> SpanAttributes.SESSION_ID
```

Existing `MESSAGE_TRACE` tasks should carry `MessageTraceInfo.metadata["trace_session_id"]` when the app path already
emits such a task. App generation pipelines should not add extra message trace enqueueing for this feature.

It should intentionally differ from `trace_id` in these ways:

- Accept only explicit Service API session inputs: `X-Trace-Session-Id`, `trace_session_id` query parameter, and
  `trace_session_id` JSON body field.
- Do not read `X-Trace-Id`, `trace_id`, OpenTelemetry context, `traceparent`, or W3C baggage as session inputs.
- Do not affect `BaseTraceInfo.trace_id` or `BaseTraceInfo.resolved_trace_id`.
- Do not change Dify `conversation_id`, `workflow_run_id`, `message_id`, OpenTelemetry trace/span IDs, or span
  parent-child relationships.
