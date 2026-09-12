# External memory

The `dify.external_memory` layer uses two configured plugin tools as private lifecycle callbacks. It does not expose those
callbacks as model tools and has no dependency on a particular memory service. Use the reserved layer name `external_memory`
and dependency `execution_context`. The API supplies freshly resolved tool configurations and credentials for each run;
layer session state is empty. Native history and tiered compaction remain owned by the runtime.

The persisted application contract is `AgentSoulConfig.memory.external`. It contains `prepare` and `observe` tool references,
`subject_kind` (`user` or `business`), optional literal `subject_id` required for business mode, `max_bytes` (8000),
`capture_max_bytes` (8192), and `capture` (true). Both byte limits accept 512 through 32768. No secret is stored in these
references. The existing tenant-scoped tool owner resolves credentials at invocation time. The shared Web composer edits
this contract for Agent apps and Workflow Agent V2.

Each callback receives `memory_context` with `app_id`, `subject_kind` and `subject_id`. These values override configured tool
parameters and are never supplied by the model. User mode uses the trusted execution user; business mode intentionally
shares a configured literal identifier within the app. Providers must implement authorization separately from identity routing.

Prepare receives `request: {query, max_bytes}` and must emit exactly one JSON message with either:

```json
{"status": "ready", "content": "Historical evidence", "content_bytes": 19}
```

or `{"status":"empty","content":null,"content_bytes":0}`. `content_bytes` is the exact UTF-8 size. Recall is capped by the
configured limit and one quarter of a known input budget. The runtime attaches it as untrusted evidence to transient model
instructions before compaction. Existing history persistence clears those instructions.

Observe receives `request: {event_id, event, sequence, payload, metadata, max_bytes}` and acknowledges with
`{"status":"accepted"}`. Events are `user_prompt`, `model_response`, `tool_call`, `tool_result`, and `run_end`. Only visible
model text is captured; structured final output is included. The runtime excludes ThinkingPart and known reasoning tags,
redacts sensitive JSON keys, serializes supported structured tool results, and bounds each payload before daemon transport.
The provider may apply additional redaction and truncation. A paused continuation has no new user prompt to recapture.

Callbacks run with a ten-second timeout by default (runtime limit at most thirty seconds). Calls are serialized per run;
a failed callback is disabled for the remaining run. Errors log sanitized outcome categories. Configuration resolution
failure at the API also degrades memory. The next run retries normally. Capture is best effort until the provider accepts it;
there is no persistent runtime outbox or exactly-once delivery claim. Cancellation cleanup must preserve native history even
when a final observation is interrupted.

A provider may distinguish durable evidence acceptance from extracted searchable memory. Configure extraction or checkpoints
according to that provider's contract; the runtime does not automatically flush after every event.

Run `uv run --project dify-agent --extra server python -m pytest dify-agent/tests/local/dify_agent/layers/memory` for runtime
coverage. API request builders and shared Web composer tests cover reference persistence and private callback selection.
