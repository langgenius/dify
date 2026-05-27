# Dify CLI — E2E Test Suite

End-to-end tests that exercise the **real `difyctl` binary** against a live
Dify server. Every test uses an isolated temporary config directory so no
state leaks between test files.

## Directory layout

```
test/e2e/
├── setup/
│   ├── env.ts              — Load & validate DIFY_E2E_* env vars
│   ├── global-setup.ts     — Health-check server + mint disposable token
│   └── global-teardown.ts  — Delete conversations created during the run
│
├── helpers/
│   ├── cli.ts              — run(), withAuthFixture(), mintFreshToken(),
│   │                         injectAuth(), spawn_background()
│   ├── assert.ts           — assertExitCode, assertJson, assertErrorEnvelope,
│   │                         assertNoAnsi, assertPipeFriendlyJson, …
│   ├── cleanup-registry.ts — registerConversation() / cleanupRegisteredConversations()
│   ├── retry.ts            — withRetry(fn, { attempts, delayMs })
│   └── skip.ts             — optionalIt(), optionalDescribe()
│
└── suites/
    ├── auth/
    │   ├── status.e2e.ts   — auth status (text + JSON + SSO)
    │   ├── use.e2e.ts      — workspace switching
    │   ├── whoami.e2e.ts   — whoami + external SSO session checks
    │   ├── devices.e2e.ts  — devices list + revoke (runs near-last)
    │   └── logout.e2e.ts   — logout + local credential cleanup (runs last)
    ├── config/
    │   └── config.e2e.ts   — config path/get/set/unset/view, env override
    └── run/
        ├── run-app-basic.e2e.ts     — basic run, -o json, --inputs, streaming,
        │                              conversation, CI mode
        ├── run-app-streaming.e2e.ts — Ctrl+C / error-event / chunk timing
        ├── run-app-file.e2e.ts      — --file upload (local + remote URL)
        └── run-app-hitl.e2e.ts      — HITL pause + resume
```

## Setup

Copy the credential template and fill in your values:

```bash
cp cli/.env.e2e.example cli/.env.e2e
# edit cli/.env.e2e with real credentials
```

### Required env vars

| Variable                   | Description                                              |
| -------------------------- | -------------------------------------------------------- |
| `DIFY_E2E_HOST`            | Staging server base URL (`http://localhost`)             |
| `DIFY_E2E_TOKEN`           | Internal user bearer token (`dfoa_…`)                    |
| `DIFY_E2E_WORKSPACE_ID`    | Primary workspace ID                                     |
| `DIFY_E2E_CHAT_APP_ID`     | Chat app — outputs `echo: {query}`                       |
| `DIFY_E2E_WORKFLOW_APP_ID` | Workflow app — input `x` (required), outputs `echo: {x}` |

### Optional env vars

| Variable                  | Description                                          |
| ------------------------- | ---------------------------------------------------- |
| `DIFY_E2E_SSO_TOKEN`      | External SSO bearer token (`dfoe_…`)                 |
| `DIFY_E2E_HITL_APP_ID`    | Workflow app with a Human-Input node                 |
| `DIFY_E2E_FILE_APP_ID`    | Workflow app with a file input variable (`doc`)      |
| `DIFY_E2E_WORKSPACE_NAME` | Display name for the primary workspace               |
| `DIFY_E2E_EMAIL`          | Console account email (enables disposable tokens)    |
| `DIFY_E2E_PASSWORD`       | Console account password (enables disposable tokens) |

> `DIFY_E2E_EMAIL` + `DIFY_E2E_PASSWORD` are used by `global-setup` and the
> `devices`/`logout` suites to mint fresh single-use `dfoa_` tokens via the
> device flow API, so those tests never revoke the shared `DIFY_E2E_TOKEN`.

## Running tests

```bash
cd cli

# Run the full E2E suite
bun run test:e2e

# Run only [P0] smoke cases
bun run test:e2e:smoke

# Run offline-safe config tests only (no network required)
bun run test:e2e:local

# Run a single file
bun vitest --config vitest.e2e.config.ts test/e2e/suites/auth/status.e2e.ts
```

## Test execution order

Files run sequentially (`fileParallelism: false`) in this order:

```
status → use → whoami → config → run (basic / streaming / file / HITL)
  → devices → logout
```

`devices` and `logout` run last because they revoke real server sessions.

## Design decisions

| Decision                                | Rationale                                                                                                                                            |
| --------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| **No mocking**                          | All HTTP traffic goes to the real server — this catches real integration regressions.                                                                |
| **Isolated config dirs**                | Each test creates a fresh `withTempConfig()` dir; session state never leaks between tests.                                                           |
| **`withAuthFixture()`**                 | Combines `withTempConfig` + `injectAuth` into a single fixture; reduces beforeEach boilerplate.                                                      |
| **`injectAuth()` bypasses Device Flow** | Non-auth tests skip the browser step; only `auth/` suites exercise the real flow.                                                                    |
| **`mintFreshToken()`**                  | `logout` and `devices-revoke` tests mint a disposable `dfoa_` token via the device flow API, so revoking it never kills the shared `DIFY_E2E_TOKEN`. |
| **Global `retry: 0`**                   | Flaky network calls use `withRetry()` locally with `shouldRetry` filtering; global retry masks non-idempotent failures (e.g. logout).                |
| **Conversation cleanup**                | `registerConversation()` + global-teardown delete staging conversations after the run.                                                               |
