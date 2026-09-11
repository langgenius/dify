# Trace providers

OPS sends every provider an immutable `CompletedTrace` containing the full span tree. Provider code translates these spans and performs synchronous, bounded network calls. It does not query Dify records, reconstruct workflow trees, retain credentials between exports, or configure a global SDK.

The shared types live in [`trace_data.py`](../../core/ops/trace_data.py). Configuration schemas, encryption and secret-field selection live in [`provider_config.py`](../../core/ops/provider_config.py). [`provider_export.py`](../../core/ops/provider_export.py) selects a fresh client for each delivery and adds destination ownership to returned parent receipts.

To add a provider:

1. Add its package under `trace-<name>/`, with a Pydantic configuration class and a client implementing `verify_credentials()`, `get_project_url()`, and `export_trace(completed_trace, parent_span=None)`.
2. Add its name and config fields in `provider_config.py`, then its client construction in `provider_export.py`. Keep secret keys in the encrypted field list.
3. Register the package in the API workspace sources and trace dependency groups. Include `py.typed` with the package.
4. Exercise the real request serialization with a fake HTTP transport. Cover parent-first trees, deterministic IDs, auth isolation, retryable failures, and supported parent receipts.

Use `TraceProviderHttpClient` for HTTP. It creates and closes an SSRF-aware HTTP client per request, disables redirects, and limits the overall export duration. Use the shared OTLP builder for OTLP providers. gRPC exports use an explicit channel and the configured SSRF proxy; they fail closed if proxy bypass rules would skip that proxy.

Providers that support deployment-level transport settings implement `Config.load_runtime_settings(provider_config)`. Keep environment names and precedence in the provider directory, return JSON-safe copied values, and use the shared TLS helpers to capture certificate contents. OPS includes those values in the destination fingerprint and passes the checked snapshot as `_runtime_settings` to the client. A client receiving that key must use its contents without rereading environment variables or certificate files. Direct verification resolves a fresh snapshot. Runtime credentials are never saved in trace bodies or configuration API responses.

Return `ExportedParentSpans` keyed by internal span ID, with the provider IDs needed to append a later operation. The delivery worker retains only the root receipt. Databricks and MLflow artifact exports use a separate linked trace for late operations because updating a completed trace artifact would overwrite sibling work. Raise `TraceExportError` with a safe reason and an explicit retry classification; never include credentials or trace content in errors.

The ten choices remain Langfuse, LangSmith, Opik, Weave, Arize, Phoenix, Aliyun, MLflow, Databricks and Tencent. Their existing configuration APIs and encrypted credentials remain supported. There is one OPS runtime; the former unified/legacy switch is removed.

## MLflow artifacts

MLflow falls back to completed-trace metadata and artifact uploads when its OTLP endpoint is unavailable, including FileStore-backed tracking servers. Servers without the V3 trace API use the V2 API and retain their allocated trace IDs across retries. Artifacts must be served over HTTP or HTTPS. `mlflow-artifacts:/` locations use the tracking server's artifact proxy; configure MLflow with `--serve-artifacts` and an experiment artifact location served by that proxy or another HTTP artifact server. The tracking server's credentials and client certificate are sent only to its own origin.

Direct `file:`, `s3:` and `gs:` artifact locations are intentionally unsupported and fail with `mlflow_artifact_requires_http`. Before rollout, expose those stores through MLflow's HTTP artifact serving. This keeps local file writes and cloud storage credentials on the artifact server. Databricks continues to use its authenticated signed-upload API.

## Langfuse v4

Langfuse uses SDK v4 attribute builders and its propagation span processor with local OpenTelemetry spans, following the [v4 migration workflow](https://raw.githubusercontent.com/langfuse/skills/main/skills/langfuse/references/v4-project-migration.md). Each export owns its tracer provider and span collector; it sends the completed tree synchronously through `TraceProviderHttpClient` to `/api/public/otel/v1/traces`. No global Langfuse client or global OpenTelemetry provider is configured. The SDK is pinned to `4.15.2` because preserving historical timestamps and isolating concurrent destinations requires internal SDK helpers; recheck the adapter before changing that pin.

Trace name, user, session and Dify metadata propagate to observations. Input and output belong to observations; deprecated trace-level input/output are not emitted. Model usage and cost belong to generation observations.

Complete these deployment checks after the code-only migration:

1. Confirm the destination is Langfuse Cloud or self-hosted v4. Upgrade self-hosted v3 before deploying this adapter. Omitted or blank hosts now default to `https://cloud.langfuse.com`, matching the SDK and UI. Explicitly saved hosts are preserved; replace obsolete `https://api.langfuse.com` settings with the verified project's regional host.
2. Inspect project evaluations and variable mappings. The root observation is a candidate for whole-workflow evaluation; consolidate the required variables on the chosen observation. No project data or evaluator configuration was inspected during the code-only migration. Evaluation and export/read-path checks remain blocked until project access is available.
3. Send a canary workflow with root, tool and generation observations. Verify their hierarchy, observation input/output, user/session correlation, timestamps, model tokens and cost in the project before cutover. Confirm the evaluator reads its chosen observation and project exports retain the needed fields.
4. Quiesce producers and drain pending exports and workflows that retain old Langfuse parent receipts before rollout. Old receipts use UUIDs; new receipts use 32-character trace IDs and 16-character span IDs in hexadecimal. The adapter rejects legacy receipts instead of attaching them to an incompatible parent.
5. Account for at-least-once delivery. A synchronous send confirms the response for the whole tree, but a timeout after remote acceptance can trigger a retry. Deterministic IDs do not guarantee server deduplication; do not dual-send or replay spans already accepted by Langfuse.
6. Roll back only after quiescing producers and draining or explicitly retiring new deliveries and parent-dependent workflows. Confirm the destination still supports the old ingestion API before restoring the old exporter; rollback must not replay accepted spans.
