---
title: API Contract v1.17 F-007 — difyctl CLI
id: F-007
status: draft
owner: TBD
updated: 2026-09-20
---

# API Contract v1.17 F-007 — difyctl CLI

> A client, not a server. Its contract has two halves: the command surface it offers a user, and the HTTP surface it consumes.

## Surface summary

`difyctl` is published as `@langgenius/difyctl` v1.17.1 [D: cli/package.json]. It exposes 28 leaf commands, registered through a generated tree that CI checks for drift [D: cli/src/commands/tree.generated.ts:1].

It serves no HTTP surface of its own.

## Command surface

| Command | Source |
| --- | --- |
| `difyctl auth devices list` | `cli/src/commands/auth/devices/list/index.ts` |
| `difyctl auth devices revoke` | `cli/src/commands/auth/devices/revoke/index.ts` |
| `difyctl auth list` | `cli/src/commands/auth/list/index.ts` |
| `difyctl auth login` | `cli/src/commands/auth/login/index.ts` |
| `difyctl auth logout` | `cli/src/commands/auth/logout/index.ts` |
| `difyctl auth whoami` | `cli/src/commands/auth/whoami/index.ts` |
| `difyctl config get` | `cli/src/commands/config/get/index.ts` |
| `difyctl config path` | `cli/src/commands/config/path/index.ts` |
| `difyctl config set` | `cli/src/commands/config/set/index.ts` |
| `difyctl config unset` | `cli/src/commands/config/unset/index.ts` |
| `difyctl config view` | `cli/src/commands/config/view/index.ts` |
| `difyctl create member` | `cli/src/commands/create/member/index.ts` |
| `difyctl delete member` | `cli/src/commands/delete/member/index.ts` |
| `difyctl describe app` | `cli/src/commands/describe/app/index.ts` |
| `difyctl env list` | `cli/src/commands/env/list/index.ts` |
| `difyctl export studio-app` | `cli/src/commands/export/studio-app/index.ts` |
| `difyctl get app` | `cli/src/commands/get/app/index.ts` |
| `difyctl get member` | `cli/src/commands/get/member/index.ts` |
| `difyctl get workspace` | `cli/src/commands/get/workspace/index.ts` |
| `difyctl import studio-app` | `cli/src/commands/import/studio-app/index.ts` |
| `difyctl resume app` | `cli/src/commands/resume/app/index.ts` |
| `difyctl run app` | `cli/src/commands/run/app/index.ts` |
| `difyctl set member` | `cli/src/commands/set/member/index.ts` |
| `difyctl skills install` | `cli/src/commands/skills/install/index.ts` |
| `difyctl use account` | `cli/src/commands/use/account/index.ts` |
| `difyctl use host` | `cli/src/commands/use/host/index.ts` |
| `difyctl use workspace` | `cli/src/commands/use/workspace/index.ts` |
| `difyctl version` | `cli/src/commands/version/index.ts` |

## Consumed HTTP surface

The CLI does not hand-write request paths. It calls the backend through the generated oRPC client built from the shared contract package [D: cli/src/api/apps.ts:5]:

```ts
import type { AppListResponse } from '@dify/contracts/api/openapi/types.gen'
const orpc = createOpenApiClient(http)
await orpc.apps.get({ query: { workspace_id, page, limit } })
```

[D: cli/src/api/apps.ts:26]

This makes `packages/contracts/generated/api/openapi/*.gen.ts` a runtime dependency of the CLI, not only a documentation artefact [D: packages/contracts/generated/api/openapi/orpc.gen.ts].

I: the CLI targets the public OAuth API (`/openapi/v1`) rather than the Console API — basis: every client module imports from `@dify/contracts/api/openapi`, and the auth commands implement an OAuth device flow [D: cli/src/api/oauth-device.ts; api/controllers/openapi/oauth_device.py:128].

| CLI client module | Consumes |
| --- | --- |
| `cli/src/api/apps.ts` | app list and describe |
| `cli/src/api/app-dsl.ts` | studio app DSL import/export |
| `cli/src/api/app-run.ts` | app run and resume |
| `cli/src/api/members.ts` | workspace members |
| `cli/src/api/workspaces.ts` | Workspaces |
| `cli/src/api/account.ts` | account identity |
| `cli/src/api/account-sessions.ts` | device sessions |
| `cli/src/api/oauth-device.ts` | OAuth device flow |
| `cli/src/api/file-upload.ts` | file upload |
| `cli/src/api/meta.ts` | server metadata and version compatibility |

## Events

None. The CLI is request/response only [D: cli/src/http/].

## Error model

Errors are `BaseError` subclasses carrying an `ErrorCode`, mapped to deterministic process exit codes [D: cli/src/errors/codes.ts; cli/src/errors/base.ts].

A stated constraint the survey could not attach to any backend feature belongs here:

> "User aborts (ctrl+C) must never retry. Timeouts and other transport errors fall through to shouldRetry, which enforces the method allowlist." [D: cli/src/http/client.ts:210]

> "Best-effort nudge: never throws, never blocks. Lives here so every authed command flows through it without per-command wiring." [D: cli/src/commands/_shared/authed-command.ts:73]

I: exit codes are part of the CLI's public contract — basis: a test asserts determinism against a numbered spec, "Spec 5.113: exit codes must be deterministic — the same error condition must always produce the same exit code" [D: cli/test/e2e/suites/error-handling/exit-codes.e2e.ts:145].

OPEN: where does "Spec 5.113" live? `cli/test/e2e/suites/error-handling/exit-codes.e2e.ts:145` cites a numbered specification that is not in this repository.

## Versioning and compatibility

`difyctl version --check-compat` exits with `COMPAT_FAIL_EXIT_CODE`, which is `64`, when the server is not reported compatible [D: cli/src/commands/version/index.ts:10; cli/src/commands/version/index.ts:56].

OPEN: what is the supported version skew between `difyctl` and a Dify server? The check exists; the policy it enforces is not written down.

## Spec files

`packages/contracts/generated/api/openapi/{types,zod,orpc}.gen.ts` is the authoritative contract for every call this CLI makes [D: packages/contracts/generated/api/openapi/].

OPEN: what regenerates `packages/contracts` and when — is a backend change that alters a response shape required to regenerate it in the same commit?

## Traceability

Stories in `PRDs/prd_v1.17_F-007-difyctl-cli.md`; test cases in `tests/test_v1.17_F-007.md`.

OPEN: `cli/ARD.md` is the team's own architecture reference for this package. Should this hub own the CLI design record, or defer to `cli/ARD.md` and link it? Two documents describing one package will drift.
