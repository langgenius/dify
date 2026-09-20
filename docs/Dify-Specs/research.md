---
title: Research — Dify
status: draft
owner: TBD
updated: 2026-09-20
---

# Research — Dify

> What the code shows this product depends on. Nothing here records why a dependency was chosen.

## Third-party integrations

| Category | Count | Evidence |
| --- | --- | --- |
| Vector databases | 43 packages | `api/providers/vdb/` |
| Tracing backends | 8 packages (Langfuse, LangSmith, Opik, Weave, MLflow, Arize Phoenix, Aliyun, Tencent) | `api/providers/trace/` |
| Model and tool providers | hosted out of process | `docker/docker-compose.yaml:573` |
| Object storage, mail, telemetry | wired as extensions | `api/extensions/` |

Client SDKs are published for Node and PHP [D: sdks/nodejs-client/package.json; sdks/php-client/composer.json].

OPEN: which of the 43 vector stores are first-party supported and which are community contributions retained for
compatibility? The packaging is identical for all of them.

## Spikes

OPEN: none recoverable. A working tree keeps the result of an experiment and not the experiment.

## Reference material

In-repo documents that carry the team's own wording and outrank anything reconstructed here:

| Document | Subject |
| --- | --- |
| `README.md` | product positioning |
| `CONTRIBUTING.md` | contribution process |
| `SECURITY.md` | vulnerability reporting |
| `AGENTS.md`, `api/AGENTS.md`, `cli/AGENTS.md`, `cli/src/commands/AGENTS.md` | instructions for coding agents |
| `cli/ARD.md` | the CLI's own architecture reference |
| `api/controllers/API_SCHEMA_GUIDE.md` | how to declare request and response schemas |
| `api/enterprise/telemetry/DATA_DICTIONARY.md` | telemetry fields |
| `api/openapi/markdown/*.md` | generated API contract, 1.1 MB |
| `api/tests/unit_tests/core/workflow/graph_engine/README.md` | graph engine test notes |

OPEN: `AGENTS.md` files instruct coding agents. Where they and `CONTRIBUTING.md` differ, which is authoritative for a
human contributor?
