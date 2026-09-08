# Trace providers

OPS sends every provider an immutable `CompletedTrace` containing the full span tree. Provider code translates these spans and performs synchronous, bounded network calls. It does not query Dify records, reconstruct workflow trees, retain credentials between exports, or configure a global SDK.

The shared types live in [`trace_data.py`](../../core/ops/trace_data.py). Configuration schemas, encryption and secret-field selection live in [`provider_config.py`](../../core/ops/provider_config.py). [`provider_export.py`](../../core/ops/provider_export.py) selects a fresh client for each delivery and adds destination ownership to returned parent receipts.

To add a provider:

1. Add its package under `trace-<name>/`, with a Pydantic configuration class and a client implementing `verify_credentials()`, `get_project_url()`, and `export_trace(completed_trace, parent_span=None)`.
2. Add its name and config fields in `provider_config.py`, then its client construction in `provider_export.py`. Keep secret keys in the encrypted field list.
3. Register the package in the API workspace sources and trace dependency groups. Include `py.typed` with the package.
4. Exercise the real request serialization with a fake HTTP transport. Cover parent-first trees, deterministic IDs, auth isolation, retryable failures, and supported parent receipts.

Use `TraceProviderHttpClient` for HTTP. It creates and closes an SSRF-aware HTTP client per request, disables redirects, and limits the overall export duration. Use the shared OTLP builder for OTLP providers. gRPC exports use an explicit channel and the configured SSRF proxy; they fail closed if proxy bypass rules would skip that proxy.

Return `ExportedParentSpans` keyed by internal span ID, with the provider IDs needed to append a later operation. The delivery worker retains only the root receipt. Databricks uses a separate linked trace for late operations because updating a completed trace artifact would overwrite sibling work. Raise `TraceExportError` with a safe reason and an explicit retry classification; never include credentials or trace content in errors.

The ten choices remain Langfuse, LangSmith, Opik, Weave, Arize, Phoenix, Aliyun, MLflow, Databricks and Tencent. Their existing configuration APIs and encrypted credentials remain supported. There is one OPS runtime; the former unified/legacy switch is removed.
