# Dify CLI — E2E Test Suite

End-to-end tests that exercise the **real `difyctl` binary** against a live
Dify server. Every test uses an isolated temporary config directory so no
state leaks between test files.

## Directory layout

```
test/e2e/
├── setup/
│   ├── env.ts              — Load & validate DIFY_E2E_* env vars (CE + EE)
│   ├── global-setup.ts     — CE/EE-aware bootstrap: account creation, token
│   │                         minting, workspace provisioning, DSL import
│   └── global-teardown.ts  — Delete conversations created during the run
│
├── helpers/
│   ├── cli.ts              — run(), withAuthFixture(), mintFreshToken(),
│   │                         injectAuth(), spawn_background()
│   ├── assert.ts           — assertExitCode, assertJson, assertErrorEnvelope,
│   │                         assertNoAnsi, assertPipeFriendlyJson, ...
│   ├── cleanup-registry.ts — registerConversation() / cleanupRegisteredConversations()
│   ├── retry.ts            — withRetry(fn, { attempts, delayMs })
│   └── skip.ts             — optionalIt(), optionalDescribe(),
│                             enterpriseOnlyIt(), enterpriseOnlyDescribe(), isEE()
│
└── suites/
    ├── auth/
    │   ├── status.e2e.ts   — auth status (text + JSON + SSO)
    │   ├── use.e2e.ts      — workspace switching ([EE] cases require 2 workspaces)
    │   ├── whoami.e2e.ts   — whoami + external SSO session checks
    │   ├── devices.e2e.ts  — devices list + revoke (runs near-last)
    │   └── logout.e2e.ts   — logout + local credential cleanup (runs last)
    ├── config/
    │   └── config.e2e.ts   — config path/get/set/unset/view, env override
    ├── discovery/
    │   ├── get-app-list.e2e.ts           — basic get app list
    │   ├── get-app-single.e2e.ts         — get single app by ID
    │   ├── describe-app.e2e.ts           — describe app
    │   └── get-app-all-workspaces.e2e.ts — get app -A ([EE] multi-workspace cases)
    └── run/
        ├── run-app-basic.e2e.ts      — basic run, -o json, --inputs, streaming,
        │                               conversation, CI mode
        ├── run-app-streaming.e2e.ts  — Ctrl+C / error-event / chunk timing
        ├── run-app-file.e2e.ts       — --file upload (local + remote URL)
        ├── run-app-reasoning.e2e.ts  — separated-mode reasoning (--think); opt-in
        └── run-app-hitl.e2e.ts       — HITL pause + resume
```

## Edition support

`difyctl` supports two Dify editions. The test suite adapts automatically:

| Edition                 | `DIFY_E2E_EDITION` | Workspaces       | EE-only cases |
| ----------------------- | ------------------ | ---------------- | ------------- |
| Community Edition (CE)  | `ce` (default)     | 1                | Skipped       |
| Enterprise Edition (EE) | `ee`               | 2 (auto-created) | Active        |

### EE-only test cases

Tests that require Enterprise Edition features (workspace switching between
independent workspaces, cross-workspace app query, etc.) are tagged `[EE]`
in their names and wrapped with `enterpriseOnlyIt()` / `enterpriseOnlyDescribe()`
from `helpers/skip.ts`. In CE mode these tests are automatically skipped.

```ts
// helpers/skip.ts usage
const eeIt = enterpriseOnlyIt(caps)
eeIt('[EE][P0] cross-workspace query returns apps from all workspaces', async () => {
  // test body
})
```

## Setup

Copy the credential template and fill in your values:

```bash
cp cli/test/e2e/.env.e2e.example cli/.env.e2e
# edit cli/.env.e2e with real credentials
```

### Community Edition (CE) — minimum 3 vars

| Variable            | Description                                           |
| ------------------- | ----------------------------------------------------- |
| `DIFY_E2E_HOST`     | Server base URL (`http://localhost`)                  |
| `DIFY_E2E_EMAIL`    | Account email — created automatically by global-setup |
| `DIFY_E2E_PASSWORD` | Account password                                      |

global-setup will:

1. Register the account (idempotent — safe to rerun)
1. Login and mint a bearer token via the device flow
1. Import all DSL fixtures into the single workspace
1. Publish apps and set access_mode → public

### Enterprise Edition (EE) — 5 required vars

| Variable                             | Description                                             |
| ------------------------------------ | ------------------------------------------------------- |
| `DIFY_E2E_EDITION`                   | Must be `ee`                                            |
| `DIFY_E2E_HOST`                      | Console/API base URL                                    |
| `DIFY_E2E_EMAIL`                     | Member account email — created via enterprise API       |
| `DIFY_E2E_PASSWORD`                  | Member account password                                 |
| `DIFY_E2E_ENTERPRISE_API_URL`        | Enterprise admin API base URL (`https://.../inner/api`) |
| `DIFY_E2E_ENTERPRISE_API_SECRET_KEY` | Enterprise admin API secret key                         |

Optional:

| Variable               | Description                                   |
| ---------------------- | --------------------------------------------- |
| `DIFY_E2E_CONSOLE_URL` | Console URL if different from `DIFY_E2E_HOST` |

global-setup will:

1. Create the member account via the enterprise admin API (idempotent)
1. Login and obtain a session cookie
1. Create two workspaces (`e2e-primary-auto`, `e2e-secondary-auto`) via the enterprise API
1. Import DSL fixtures into both workspaces
1. Publish apps and set access_mode → public via the enterprise API

### Optional overrides (both editions)

| Variable                             | Description                                      |
| ------------------------------------ | ------------------------------------------------ |
| `DIFY_E2E_TOKEN`                     | Pre-minted bearer token — skips device-flow mint |
| `DIFY_E2E_SSO_TOKEN`                 | External SSO bearer token (`dfoe_...`)           |
| `DIFY_E2E_WORKSPACE_ID`              | Override primary workspace ID                    |
| `DIFY_E2E_WORKSPACE_NAME`            | Override primary workspace name                  |
| `DIFY_E2E_WS2_ID`                    | Override secondary workspace ID (EE)             |
| `DIFY_E2E_CHAT_APP_ID`               | Override echo-chat app ID                        |
| `DIFY_E2E_WORKFLOW_APP_ID`           | Override echo-workflow app ID                    |
| `DIFY_E2E_FILE_APP_ID`               | Override file-upload app ID                      |
| `DIFY_E2E_FILE_CHAT_APP_ID`          | Override file-chat app ID                        |
| `DIFY_E2E_HITL_APP_ID`               | Override HITL main app ID                        |
| `DIFY_E2E_HITL_EXTERNAL_APP_ID`      |                                                  |
| `DIFY_E2E_HITL_SINGLE_ACTION_APP_ID` |                                                  |
| `DIFY_E2E_HITL_MULTI_NODE_APP_ID`    |                                                  |
| `DIFY_E2E_WS2_APP_ID`                | Override secondary workspace app ID (EE)         |
| `DIFY_E2E_REASONING_APP_ID`          | separated-reasoning chatflow app ID (opt-in)     |
| `DIFY_E2E_REASONING_PROVISION`       | `1` → auto-provision `reasoning-chat.yml`        |

### Separated-mode reasoning suite (opt-in)

`run-app-reasoning.e2e.ts` verifies the out-of-band `reasoning_chunk` channel
(PR #37460): `--think` surfaces the chain-of-thought to stderr framed as
`<think>…</think>`, the answer stays clean, and `-o json` persists it under
`metadata.reasoning`. It is **skipped** unless `DIFY_E2E_REASONING_APP_ID`
resolves, because it runs a real LLM node and needs:

1. a chatflow whose LLM node uses `reasoning_format: separated`, and
1. a workspace with a default chat model configured.

Point `DIFY_E2E_REASONING_APP_ID` at such an app, or set
`DIFY_E2E_REASONING_PROVISION=1` to import the `reasoning-chat.yml` fixture
(its system prompt forces a `<think>` block, so any chat model triggers the
separated path — no dedicated reasoning model required).

## Running tests

```bash
cd cli

# Community Edition (default)
bun run test:e2e

# Enterprise Edition
DIFY_E2E_EDITION=ee bun run test:e2e

# Run only [P0] smoke cases
bun run test:e2e:smoke

# Run only EE-tagged cases (P0 smoke)
DIFY_E2E_EDITION=ee bun run test:e2e:smoke --testNamePattern "\[EE\]"

# Run offline-safe config tests only (no network required)
bun run test:e2e:local

# Run a single file
bun vitest --config vitest.e2e.config.ts test/e2e/suites/auth/status.e2e.ts
```

## Test execution order

Files run sequentially (`fileParallelism: false`) in this order:

```
login → status → use → whoami → help → config → output → error-handling
  → framework → discovery → run (basic / streaming / file / HITL)
  → devices → logout
```

`devices` and `logout` run last because they revoke real server sessions.

## Design decisions

| Decision                                | Rationale                                                                                                                  |
| --------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| **CE/EE edition flag**                  | `DIFY_E2E_EDITION=ce/ee` controls global-setup bootstrap path and activates/skips `[EE]`-tagged tests.                     |
| **`[EE]` tag convention**               | Test names include `[EE]` to make skipped cases visible in the report and to allow `--testNamePattern "\[EE\]"` filtering. |
| **`enterpriseOnlyIt(caps)`**            | Returns `it` in EE mode, `it.skip` in CE mode — no runtime assertions needed, skip is declarative.                         |
| **No mocking**                          | All HTTP traffic goes to the real server — this catches real integration regressions.                                      |
| **Isolated config dirs**                | Each test creates a fresh `withTempConfig()` dir; session state never leaks between tests.                                 |
| **`withAuthFixture()`**                 | Combines `withTempConfig` + `injectAuth` into a single fixture; reduces beforeEach boilerplate.                            |
| **`injectAuth()` bypasses Device Flow** | Non-auth tests skip the browser step; only `auth/` suites exercise the real flow.                                          |
| **`mintFreshToken()`**                  | `logout` and `devices-revoke` tests mint a disposable `dfoa_` token via the device flow API.                               |
| **Global `retry: 0`**                   | Flaky network calls use `withRetry()` locally; global retry masks non-idempotent failures.                                 |
| **Conversation cleanup**                | `registerConversation()` + global-teardown delete staging conversations after the run.                                     |
