# Execution context module

`dify_agent.layers.execution_context.layer` declares Config, empty State and
Capability. Config carries tenant/user/app/invoke identity and correlation IDs.
Other modules refer to its registered name in their Config. Server-only daemon
settings and clients are borrowed from Deps.services. Knowledge retrieval
requires its complete caller identity before any external request.

The optional `tracing` field is an API-issued `ApplicationTracingContext`:

```json
{
  "version": 1,
  "run_id": "429cab49-8663-42b4-a701-ac1038ee4fa7",
  "invocation_id": "95bdeed9-4652-4708-8322-b866f159ad62",
  "trace_id": "81b617d638eb419ba2b209c14984d908",
  "parent_span_id": "716db0b6c736b395",
  "session_id": "conversation-id",
  "capture_content": false,
  "sampled": true
}
```

`run_id` identifies the API's persisted application trace. `invocation_id`
identifies this particular Agent execution; multiple nodes or attempts can
belong to one application trace. Both are UUIDs. The trace and parent span IDs
are nonzero, lowercase OpenTelemetry hex IDs (32 and 16 characters). The parent
is the API-owned message or Agent-node invocation, and is restored as the actual
OpenTelemetry parent rather than attached only as metadata. Tenant/app identity
continues to come from the containing execution context.

Application collection requires `DIFY_AGENT_APPLICATION_TRACING_ENABLED=true`
on the Agent server. The API owns sampling and content policy per invocation;
no third-party destination or credential is accepted in a run request. When an
application context is selected it replaces deployment trajectory instrumentation
for that invocation, including when `sampled` is false. Without an application
context, the existing deployment trajectory behavior is unchanged.
