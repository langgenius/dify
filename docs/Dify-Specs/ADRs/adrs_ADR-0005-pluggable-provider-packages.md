---
title: ADR-0005 — Vector database and tracing providers ship as separate packages
id: ADR-0005
features: [F-001, F-002, F-003, F-004, F-005, F-006, F-007]
kind: adr
status: accepted (reconstructed from code, 2026-09-20) — rationale not recovered
updated: 2026-09-20
---

# ADR-0005 — Vector database and tracing providers ship as separate packages

Status: accepted (reconstructed from code, 2026-09-20) — rationale not recovered

## Context

43 vector-database integrations live under `api/providers/vdb/`, each with its own `pyproject.toml` and its own
dependency list [D: api/providers/vdb/]. Eight tracing backends are structured the same way under
`api/providers/trace/` [D: api/providers/trace/]. Model and tool plugins are hosted out of process by the
`plugin_daemon` service [D: docker/docker-compose.yaml:573].

## Decision

Provider integrations are separately declared packages rather than optional extras or in-tree branches of the API
package [D: api/providers/vdb/vdb-qdrant/pyproject.toml].

## Alternatives considered

OPEN: not recoverable — code retains no record of what was rejected.

## Consequences

- A deployment installs only the provider packages it uses, so heavy client libraries are not a cost for every
  installation.
- Each provider carries its own tests, which the root `make test` target enumerates explicitly rather than by
  discovery [D: Makefile:106].
- 51 provider packages are 51 dependency surfaces to keep current.

OPEN: what happens at runtime when a configured provider's package is not installed — a startup failure or a request
failure? OPEN: what is the support policy for 43 vector stores; are they all first-party supported, or community
contributions retained?
