# AI SDK Gateway

OpenAI-compatible HTTP gateway that routes client requests to per-customer Dify deployments.

## Overview

```
[Client SDK] ──► [Gateway] ──► [Customer A's Dify] ──► [vLLM + Qdrant]
                     │
                     ├──► [Customer B's Dify] ──► [vLLM + Qdrant]
                     └──► [Customer C's Dify] ──► [vLLM + Qdrant]
```

## Endpoints

| Method | Path | Description |
|--------|------|-------------|
| POST | `/v1/chat/completions` | OpenAI-compatible chat (blocking + streaming) |
| GET | `/v1/models` | List available models for the authenticated customer |
| GET | `/health` | Liveness probe |

## Authentication

Clients pass `Authorization: Bearer bsa_<env>_<random>`. The gateway maps the SDK key to a Dify
deployment via `CUSTOMER_REGISTRY` (YAML).

## Model selection

Clients may pass `extra_body.llm_model` to select a model. The gateway lazy-builds a Dify App
keyed by `(customer_id, model_id)` on first request, caches the resulting App key, and reuses
it for subsequent calls. Idle entries are GC'd after a configurable TTL.

## Configuration

Environment variables (see `gateway/src/gateway/config.py`):

| Var | Default | Description |
|-----|---------|-------------|
| `GATEWAY_HOST` | `0.0.0.0` | Bind address |
| `GATEWAY_PORT` | `8080` | Bind port |
| `GATEWAY_REGISTRY_PATH` | `./registry.yaml` | Customer registry YAML path |
| `GATEWAY_LOG_LEVEL` | `INFO` | Log level |
| `GATEWAY_DIFY_TIMEOUT_S` | `60` | Dify HTTP timeout |
| `GATEWAY_APP_CACHE_TTL_S` | `604800` | App cache TTL (7 days) |
| `GATEWAY_APP_CACHE_GC_INTERVAL_S` | `3600` | GC sweep interval (1 hour) |

## Customer registry format

See `registry.example.yaml`.

## Running locally

```bash
cd gateway
pip install -e ".[dev]"
GATEWAY_REGISTRY_PATH=./registry.example.yaml uvicorn gateway.main:app --reload
```

## Running tests

```bash
pytest -v
```

## Building Docker image

```bash
docker build -t ai-sdk-gateway:dev .
docker run -p 8080:8080 \
  -v $PWD/registry.yaml:/app/registry.yaml \
  -e GATEWAY_REGISTRY_PATH=/app/registry.yaml \
  ai-sdk-gateway:dev
```

## What's in PR #1 vs PR #2

**PR #1 (this code)** — core chat path:
- R1 (partial): `/v1/chat/completions` (blocking + streaming) + `/v1/models`
- R2: customer routing via YAML registry
- R3: lazy-build per-(customer, model) Dify Apps + cache + GC
- R4: SSE conversion
- R6: references in `choices[0].message.metadata.references`
- R7: error mapping (401/404/400/429/502/504)

**PR #2 (next)** — knowledge base management:
- R1 (rest): `/v1/datasets`, `/v1/files`
- R5: per-(customer, embedding model) lazy dataset provisioning

Out of scope for both PRs:
- Bypass-Dify direct vLLM channel
- Real rate limiting (middleware hook is in place; logic is empty)
- Multi-region routing

## Architecture

```
src/gateway/
├── main.py              FastAPI entry, wires middleware + routers
├── config.py            Env-driven Pydantic Settings
├── registry.py          YAML CUSTOMER_REGISTRY loader
├── schemas.py           OpenAI-compatible request/response models
├── errors.py            Domain errors + HTTP status mapping
├── middleware/
│   ├── auth.py          SDK key extraction + customer attachment
│   └── logging.py       request_id + customer_id structured logs
├── dify/
│   ├── client.py        Async httpx wrapper for Dify Service/Console API
│   └── app_manager.py   Lazy-build per-(customer,model) App + cache + GC
├── streaming/
│   └── converter.py     Dify SSE → OpenAI chat.completion.chunk
└── routers/
    ├── chat.py          /v1/chat/completions
    └── models.py        /v1/models
```
