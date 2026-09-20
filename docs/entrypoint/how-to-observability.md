---
title: How to observe — Dify
status: draft
updated: 2026-09-20
---

# How to observe — Dify

## Health and process endpoints

| Endpoint | Source |
| --- | --- |
| `/health` | `api/extensions/ext_app_metrics.py:20` |
| `/threads` | `api/extensions/ext_app_metrics.py:28` |
| `/db-pool-stat` | `api/extensions/ext_app_metrics.py:54` |
| `/console/api/ping` | `api/controllers/console/` |
| `/console/api/version` | `api/controllers/console/` |

These are operational, not product surface, and are excluded from every feature PRD by design.

## Instrumentation

| Signal | Wiring |
| --- | --- |
| Traces and metrics | `api/extensions/ext_otel.py` |
| Errors | `api/extensions/ext_sentry.py` |
| Request logs | `api/extensions/ext_request_logging.py` |
| Log shipping | `api/extensions/ext_logstore.py` |
| Enterprise telemetry | `api/tasks/enterprise_telemetry_task.py:19`, fields in `api/enterprise/telemetry/DATA_DICTIONARY.md` |

Sampling defaults to 1.0 for both Sentry traces and profiles [D: api/configs/extra/sentry_config.py:16;
api/configs/extra/sentry_config.py:22].

## LLM tracing

Eight pluggable tracing backends ship as separate packages: Langfuse, LangSmith, Opik, Weave, MLflow, Arize Phoenix,
Aliyun, Tencent [D: api/providers/trace/]. Per-app configuration lives in `trace_app_config`
[D: api/models/model.py:2649].

## Open questions

- OPEN: what is alerted on, and by whom? No alert rule lives in this repository.
- OPEN: what are the SLOs these signals are measured against? None is stated.
- OPEN: is a Sentry sampling rate of 1.0 the production setting, or only the default an operator is expected to lower?
