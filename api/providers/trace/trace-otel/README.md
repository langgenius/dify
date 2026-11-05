# OpenTelemetry

Install the optional provider with `uv sync --group trace-otel` from `api/` (also included in `trace-all`). Select **OpenTelemetry** in application or Agent tracing settings.

| Field | Meaning |
| --- | --- |
| `endpoint` | Full OTLP/HTTP trace URL, for example `https://collector.example.com/v1/traces`. Custom paths are preserved; a bare origin gets `/v1/traces`. |
| `headers` | Optional JSON object of string HTTP headers, for example `{"Authorization":"Bearer …"}`. Encrypted per workspace and never returned. Leave unchanged to retain credentials; submit `{}` to remove them. |
| `service_name` | OTLP `service.name`; blank values use `dify`. |
| `resource_attributes` | Optional JSON object of finite primitive values or homogeneous primitive arrays, for example `{"deployment.environment.name":"production"}`. Set `service.name` through the dedicated field. |

HTTP transport headers cannot be overridden. Headers must use printable ASCII. Authentication is never carried to a changed endpoint unless re-entered. HTTP requests follow Dify's SSRF egress policy; a private collector must be allowed by that deployment's proxy policy.

The provider exports the canonical tree, retaining trace/span IDs, parent links, timing, status and structured input/output. LLM spans expose `gen_ai.*` model and token fields; wrappers do not repeat usage. Dify attributes include IDs, span kind, absolute UTC times, tool provider metadata and LLM cost. Generic collectors do not expose a standard UI URL, so no project/trace link is advertised.

Verification uses a zero-span OTLP request. It checks the endpoint's protocol response without creating traces; use a real execution and query the collector to confirm ingestion. Partial acceptance and ambiguous delivery are not retried; transient failures use the shared pipeline's retry policy. No exporter threads, process-wide OTEL environment settings, or additional database migrations are needed.

This package implements the Dify 1.19 tracing SDK. Older Enterprise releases require a separately tested compatibility adapter; installing this package alone does not upgrade their tracing pipeline or persisted nested-workflow data.
