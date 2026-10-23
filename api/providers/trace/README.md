# Trace providers

Each directory here is an optional uv workspace package that sends Dify traces (messages, workflow runs, tool calls, retrieval, moderation, and so on) to one external observability backend. `trace-sdk/` is the contract every provider implements; it is not a provider itself.

## The contract (`trace-sdk`, imported as `dify_trace_sdk`)

A provider is a subclass of `dify_trace_sdk.provider.TraceProvider[ConfigT]`:

| Member | Purpose |
|--------|---------|
| `id` | The stable provider ID stored in app tracing settings, such as `"langfuse"`. |
| `config_model` | A `ProviderConfig` subclass. Mark credentials with `secret()` and values that verification resolves with `derived()`. |
| `capabilities` | A `ProviderCapabilities` value: whether the backend prices usage natively and links to traces and spans. |
| `verify(config)` | Checks a new or edited configuration against the backend and returns it with derived fields filled. Raises `VerificationError(code)` with a stable code that contains no secret. |
| `project_url(config)` | The console link for a configuration. It must not perform I/O. |
| `send(config, trace)` | Delivers one trace unit and classifies every failure (see below). |

What `send` receives (`dify_trace_sdk.model`):

- A `Trace` is a parent-first tree of completed `Span`s that uses OpenTelemetry ID formats.
  - Each span carries timing, inputs and outputs, status, and typed LLM fields (`model_name`, `model_provider`, `usage`, `cost`, `time_to_first_token`).
  - All values are strict JSON.
- A message trace has a `message` root and an `llm` child.
- A workflow run has a `workflow` span with node spans and loop or iteration wrapper spans. For chatflows these hang under the `message` root.
- Auxiliary operations join their message's trace as separate units. `trace.parent` names the message root span, and the first span of the unit points at it.
- A workflow nested in another one is its own trace. Its root carries `parent_workflow_run_id` and `parent_node_execution_id`.
- A unit can be sent again after a retryable failure. Derive vendor IDs deterministically from the trace and span IDs (`dify_trace_sdk.ids`), so a resend updates the same records instead of duplicating them.

Failure classes (`dify_trace_sdk.errors`):

| Raise | When | Pipeline behaviour |
|-------|------|--------------------|
| `ExportRetryableError` | Nothing was accepted and the cause is transient (unreachable, 408/425/429/5xx). | Sends the same unit again later, up to `OPS_TRACE_EXPORT_MAX_ATTEMPTS` attempts in total. |
| `ExportRejectedError` | The backend refused the unit, or the configuration cannot work. | Drops the unit and logs a warning. |
| `ExportOutcomeUnknownError` | Part or all of the unit may have been accepted. | Drops the unit; sending again could duplicate it. |

Error messages are logged and must never contain credentials, request bodies, or vendor response bodies. Raise them `from None`.

## Network access

A provider never opens sockets, starts threads, or reads environment variables or files. All traffic goes through `self.egress`:

- `egress.request(...)` sends one HTTP request through the SSRF proxy, with no retries or redirects, a bounded response, and no ambient cookies.
- `egress.grpc_channel(endpoint)` opens a channel pinned to a vetted address.
- The helpers in `dify_trace_sdk.exporting` and `dify_trace_sdk.otlp` turn egress failures and HTTP or gRPC statuses into the failure classes above.

If you must use a vendor SDK, route its HTTP through `EgressHttpxTransport` or `EgressRequestsSession` (`dify_trace_sdk.transports`) and disable its batching, background threads, and retries. Importing the SDK must not change process-wide state; some SDKs install a Sentry client or patch other libraries on import.

## Configuration and secrets

Stored configurations keep the provider's fields at the top level, with `secret()` fields encrypted per workspace. Secrets are write-only:

- The console never receives them back; it gets the names of the secrets that are set.
- When an edit leaves a secret empty or omits it, the stored value is kept.
- Clients cannot set `derived()` fields.

`ProviderConfig` hides inputs from validation errors; keep validator messages fixed texts too.

## Adding a provider

1. Create `api/providers/trace/trace-<name>/` with:
   - a `pyproject.toml` for the project `dify-trace-<name>`, depending on `dify-trace-sdk` (plus any vendor SDK that is safe to import);
   - `src/dify_trace_<name>/{config.py,provider.py,py.typed}`;
   - tests that mirror the sources, e.g. `src/dify_trace_<name>/provider.py` maps to `tests/unit_tests/src/dify_trace_<name>/test_provider.py`.

   List `py.typed` under `[tool.setuptools.package-data]`.
2. Register the provider class as an entry point:

   ```toml
   [project.entry-points."dify.trace_providers"]
   <id> = "dify_trace_<name>.provider:<Name>Provider"
   ```

3. Add the ID to `SUPPORTED_PROVIDERS` in `api/services/tracing/registry.py` and the provider's form fields to the web console's tracing field registry.
4. In `api/pyproject.toml`, add `dify-trace-<name> = { workspace = true }` under `[tool.uv.sources]` and add the package to the `trace-<name>` and `trace-all` dependency groups. Then run `uv lock` and `uv sync` from `api/`.
5. Test with `dify_trace_sdk.testing.RecordingEgress` and the sample traces there. Tests must not reach the network.

`trace-langfuse/` is the smallest reference implementation; `trace-arize-phoenix/` and `trace-tencent/` show OTLP over HTTP and gRPC.

## How traces reach a provider

1. Producers emit typed events (`dify_trace_sdk.events`) through a `TraceScope` after their records are committed:
   - generators, task pipelines and the workflow persistence layer;
   - moderation, tools, retrieval, conversation naming and suggested questions.

   A scope exists only when the app has tracing enabled or enterprise telemetry is on.
2. `tasks.trace_delivery_task` delivers each event on the `ops_trace` queue:
   - `services.tracing.assembly` reloads the records through the event's workspace.
   - Enterprise telemetry receives every record.
   - The Agent trace collector takes the executions it manages.
   - `services.tracing.canonical` builds the trace for the app's current provider configuration, and the provider's `send` runs.
3. A retryable failure stores only the built trace and schedules that send again. Payloads that an interrupted delivery leaves in storage are removed daily by `sweep_trace_payloads`.
