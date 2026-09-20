---
title: How to deploy — Dify
status: draft
updated: 2026-09-20
---

# How to deploy — Dify

## Quickstart

```
cd docker
docker compose up -d
```

Then initialise the instance at `/install` in a browser [D: README.md:80].

## What starts

14 services: `api`, `api_websocket`, `worker`, `worker_beat`, `web`, `db_postgres`, `db_mysql`, `redis`, `sandbox`,
`local_sandbox`, `plugin_daemon`, `agent_backend`, `agent_ssrf_proxy`, `ssrf_proxy`, `certbot`
[D: docker/docker-compose.yaml].

## Configuration

`docker/.env` overrides the per-concern files in `docker/envs/`. `docker/.env.example` is deliberately limited to
what a default deployment needs to start; optional and provider-specific settings belong in the matching
`docker/envs/*.env.example` [D: AGENTS.md].

**No configuration value is reproduced in this documentation hub, by policy.** Read the example files directly.

## Variants

| File | Use |
| --- | --- |
| `docker-compose.middleware.yaml` | datastores only, for local backend development |
| `docker-compose.e2b.yaml` | E2B sandbox variant |
| `docker-compose-template.yaml` | the template the full file is generated from |

## Open questions

- OPEN: are migrations applied on container start or as a separate step?
- OPEN: is there a supported Kubernetes path? No chart or manifest is in this repository.
- OPEN: what is the backup and restore procedure?

Detail: `Dify-Specs/deployment/deployment_strategy.md`.
