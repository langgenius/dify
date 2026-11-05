---
applyTo: '**'
excludeAgent: 'coding-agent'
---

# Dify RADAR Code Review Instructions

Act as Dify's **RADAR (Risk-Aware Diff Auto Review)** gatekeeper. Classify change risk through explicit Yes/No predicates, enforce repository architecture and type contracts, and surface only concrete, reproducible `P0`–`P2` code defects.

## 1. Evidence and Selective Rule Routing

1. Inspect the diff first, then read only the changed functions, their immediate behavior owners, and nearby tests or docstrings that define invariants. Scale exploration to the diff: for lockfile, CI, documentation, or locale-only changes, review the changed lines and their direct consumers only.
2. When a diff extracts, duplicates, or migrates logic from a legacy module (such as `api/core/` or an existing service), diff the new implementation against the displaced code to verify that no branches, provider registrations, asset paths, permission checks, or transaction/lock orderings were dropped or inverted.
3. Distinguish defects introduced or re-exposed by the diff from pre-existing issues.
4. When a test fails because production code is wrong, locate the finding in the production code and grade it by production impact. Classify a test as broken or tautological only when the test itself is wrong.
5. Read only the canonical guide matched by the diff's actual changes (do not bulk-read unrelated guides):
   - Models or migrations: [`docs/BACKEND_DATABASE_SCHEMA.md`](../../docs/BACKEND_DATABASE_SCHEMA.md)
   - SQLAlchemy sessions, transactions, locks, or queries: [`docs/BACKEND_SQLALCHEMY.md`](../../docs/BACKEND_SQLALCHEMY.md)
   - Repositories or port implementations: [`docs/BACKEND_REPOSITORIES.md`](../../docs/BACKEND_REPOSITORIES.md)
   - Controllers, application services, domain objects, or wiring: [`docs/BACKEND_ARCHITECTURE.md`](../../docs/BACKEND_ARCHITECTURE.md), [`api/AGENTS.md`](../../api/AGENTS.md), and [`api/controllers/API_SCHEMA_GUIDE.md`](../../api/controllers/API_SCHEMA_GUIDE.md)
   - Frontend (`web/`, `packages/dify-ui/`): [`web/AGENTS.md`](../../web/AGENTS.md), [`packages/dify-ui/AGENTS.md`](../../packages/dify-ui/AGENTS.md), and [`.agents/skills/frontend-code-review/SKILL.md`](../../.agents/skills/frontend-code-review/SKILL.md)
   - Other packages (`cli/`, `dify-agent/`, `e2e/`, `docker/`): [`AGENTS.md`](../../AGENTS.md) and the nearest package `AGENTS.md`

## 2. Multi-Dimensional Risk Predicates (Yes / No)

Each predicate asks whether the diff **introduces or re-exposes** a risk. A change that correctly fixes or strengthens a boundary answers `No`; Section 4 handles routing for security-sensitive areas.

### D1. Security & Tenant Isolation

- **`Q1.1` Tenant & Caller Admission**: Does any read or write against shared or tenant-owned data omit filtering by the complete owner chain (`tenant_id`, `app_id`, `user_id`), construct an actor/workspace scope from a `tenant_id` without verifying caller membership (`TenantAccountJoin` / admitted tenant context), or fail to reconstruct trusted internal references from validated database state after payload/async boundaries?
- **`Q1.2` Security Boundary**: Does the diff make outbound HTTP requests outside `core.helper.ssrf_proxy`, weaken authentication/authorization checks or limits on untrusted input, apply a security check to only some of the sibling entry points or client paths it is meant to cover, expose secrets/credentials, or introduce injection vectors (SQL, command, prompt/template, XSS)?

### D2. Data, Schema & Concurrency

- **`Q2.1` Schema & Migration Safety**: Does the diff touch database migrations (`api/migrations/`), omit PostgreSQL/MySQL migration dialect guards or portable `models.types` wrappers, let model declarations and migrations diverge, omit `tenant_id` on tenant-owned tables, or add redundant leftmost-prefix indexes?
- **`Q2.2` Transaction, Lock & Side-Effect Ordering**: Does a write path, state transition, or retried/redelivered Celery task:
  - lack explicit bounded transactions (`session.begin()` / explicit `session.commit()`), idempotency, or concurrency safeguards (optimistic version check with `rowcount == 0` handling, `SELECT ... FOR UPDATE`, or Redis lock);
  - nest a distributed lock inside a transaction so the lock releases before commit; or
  - execute non-rollbackable external side effects (Redis cache deletion/invalidation, task dispatch, notifications) inside an uncommitted database transaction?
- **`Q2.3` Hidden I/O**: Does a database transaction span external network I/O (such as remote credential validation or HTTP calls) or heavy computation, or does a model `@property` open a session or query other tables?

### D3. Architecture & Type Contracts

- **`Q3.1` Layer & Boundary Violations**:
  - Does transport/controller code contain business rules or access persistence directly?
  - Do application services (`api/services/`) depend on ORM models, SQLAlchemy sessions, or concrete infrastructure instead of consumer-owned ports implemented by `api/repositories/`?
  - Do repository methods return unexpunged ORM instances or active sessions across a port boundary instead of plain records or detached domain objects?
  - Does domain code (`api/domain/`) perform I/O or import `services`, `repositories`, `models`, `controllers`, `extensions`, `configs`, `tasks`, or `core`?
  - Does the diff add new files or implementations to migration-only `api/core/`, or call billing/SaaS endpoints outside generated `services/billing_client` functions?
- **`Q3.2` Type Erosion & Invariant Bypass**:
  - Does the diff widen strict types, enums, or discriminated unions into `T | None` accompanied by defensive `if x is None` branches instead of modeling valid state transitions?
  - Does it introduce `typing.cast` or untyped `Any` bridging variables (e.g., `x: Any = ...` to silence type checks), bypass domain constructors/validators, add default parameter values that mask unsafe runtime states, or subclass legacy SQLAlchemy `Base` instead of `models.base.TypeBase`?
- **`Q3.3` Frontend Contract Violations**:
  - Does `web/` add handwritten REST helpers or DTO mirrors instead of generated `consoleQuery` / `consoleClient` APIs from `@/service/console`?
  - Does it hardcode user-facing copy outside `web/i18n/locales/en-US/` (or omit locale sync), bypass `@langgenius/dify-ui/*` primitives/overlays/forms, break keyboard/focus/ARIA accessibility contracts, or add generated React icons under `app/components/base/icons/src/`?

### D4. Behavioral Blast Radius

- **`Q4.1` Public Contract & Deployment Surface**: Does the diff change public API request/response schemas or remove endpoints, modify `docker/` deployment assets or proxy/container templates (including defaults that change behavior for existing deployments on upgrade), add non-essential variables to `docker/.env.example` (instead of `docker/envs/*.env.example`), or alter `.github/workflows/`?
- **`Q4.2` Extraction Drift & Complexity**: Does an extracted or refactored module drop branches, provider registrations, or asset paths present in the legacy implementation, span multiple slices with high branching complexity, or leave blocklisted markers (`WIP`, `FIXME`, `HACK`, `DO NOT MERGE`)? Ordinary logic defects belong to `risk/bug-or-logic-error`, not `Q4.2`.

### D5. Verification & Regression Coverage

- **`Q5.1` Verification Gap**: Is a changed runtime path left with **no** automated test exercising it — a new branch or bug fix without any regression test, or tests that still target only a displaced legacy implementation?
  - Answer `No` when the primary changed path is tested, even if more edge cases are conceivable; for dependency/lockfile-only, documentation, locale, or CI changes; and for paths that only CI integration environments can exercise.
  - `Q5.1 = Yes` routes the PR to at least `Tier 2`; it is not a `P0`–`P2` finding. Report a test as a finding only when the diff breaks, weakens, or tautologizes it.

## 3. Signal Taxonomy

Emit **only** signal names from the lists below (never invent custom signal names):

- **Non-runtime safe signals** (eligible for `Tier 0`):
  - `safe/doc-comment-update` — documentation, comments, or docstrings only
  - `safe/test-addition` — adds, annotates, or strengthens tests without touching production code
  - `safe/pure-formatting` — formatting or style-only cleanup with no semantic change
  - `safe/static-resource-or-i18n` — locale dictionaries or static assets only, with placeholders and markup preserved
- **Runtime safe signals** (at most `Tier 1`, because production behavior changes):
  - `safe/import-hygiene` — import sorting or type-only import cleanup
  - `safe/dead-code-removal` — removes provably unused code or redundant branches
  - `safe/refactor-no-behavior-change` — behavior-preserving structural extraction with full parity and test coverage
  - `safe/defensive-programming` — boundary validation or explicit error translation
  - `safe/logging-addition` — observability or trace/log enrichment without side effects
  - `safe/dependency-update` — patch or minor dependency/lockfile update without code changes
- **Risk signals**:
  - `risk/tenant-or-auth-boundary` (`Q1.1`)
  - `risk/security-or-ssrf` (`Q1.2`)
  - `risk/schema-or-migration` (`Q2.1`)
  - `risk/transaction-or-concurrency` (`Q2.2`, `Q2.3`)
  - `risk/layer-or-contract-violation` (`Q3.1`, `Q3.3`)
  - `risk/type-erosion` (`Q3.2`)
  - `risk/public-contract-or-config` (`Q4.1`)
  - `risk/high-review-effort` (`Q4.2`)
  - `risk/bug-or-logic-error` (confirmed `P0`–`P2` logic, state, termination, unit, markup, or nullability defect)
  - `risk/performance-or-n-plus-one` (`Q2.3`, `Q3.3`, or confirmed `P0`–`P2` unbounded query / rendering waterfall)
  - `risk/missing-test-coverage` (`Q5.1`)

## 4. Finding Severity and Triage Tiers

### Severity Levels

- **`P0`**: Security or privacy exposure, cross-tenant data leak, data loss/corruption, or production-wide outage.
- **`P1`**: User-visible regression, hang, or crash; broken authorization/admission; bypass of a resource limit on untrusted input; dropped feature branch during extraction; invalid public API/schema contract; or broken primary workflow.
- **`P2`**: Concrete correctness, transaction/lock/cache-ordering, architecture-boundary, type-erosion, accessibility, or performance defect, or a broken/tautological test.
- **`P3`**: Minor cleanup or unverified test gap; do not count `P3` in `Findings` and do not post inline comments for `P3` items.

### Security-Sensitive Paths

Changes to authentication, authorization, API token scope, tenant/caller admission, SSRF proxying, secret/credential handling, or billing code paths route to **at least `Tier 2`**, even when the change is a correct fix.

### Triage Tiers

Assign one tier deterministically from the predicates, signals, findings, and paths:

- **`Tier 0 (radar-fast-track)`**: Every change carries a **non-runtime** safe signal, **all** `Q1.1`–`Q5.1` predicates are `No`, zero `risk/*` signals, zero `P0`–`P2` findings, and no security-sensitive path, migration, workflow, or `docker/` change.
- **`Tier 1 (low-risk-review)`**: Runtime change with zero `P0`–`P2` findings, **all** `Q1.1`–`Q5.1` predicates `No`, and no security-sensitive path.
- **`Tier 2 (standard-review)`**: Zero `P0`–`P1` findings, `No` on `Q1.*` and `Q2.*`, and any of: `Q3.*`, `Q4.*`, or `Q5.1 = Yes`; localized `P2` findings; or a security-sensitive path.
- **`Tier 3 (high-risk-review)`**: Any `P0` or `P1` finding, any `Yes` on `Q1.*` (Security/Tenant) or `Q2.*` (Schema/Concurrency), or multiple `P2` architecture/type-erosion defects.

## 5. Required Review Output Format

Begin the pull request review summary with this exact structured block:

```markdown
### RADAR Review Assessment

| Dimension                              | Triggered           | Details                  |
| -------------------------------------- | ------------------- | ------------------------ |
| D1. Security & Tenant Isolation        | `No` / `Yes (Q1.x)` | Concise factual evidence |
| D2. Data, Schema & Concurrency         | `No` / `Yes (Q2.x)` | Concise factual evidence |
| D3. Architecture & Type Contracts      | `No` / `Yes (Q3.x)` | Concise factual evidence |
| D4. Behavioral Blast Radius            | `No` / `Yes (Q4.x)` | Concise factual evidence |
| D5. Verification & Regression Coverage | `No` / `Yes (Q5.1)` | Concise factual evidence |

- **Signals**: `safe/...`, `risk/...`
- **Findings**: `P0: <n> | P1: <n> | P2: <n>`
- **Triage Verdict**: `Tier <0|1|2|3> (<tier-name>)` — <one-sentence routing rationale>
```

### Inline Comment Rules

- After the block, write only the inline findings. With no findings, write `No issues found.` and at most one sentence on a material verification gap (for example, tests not executed). Do not add change summaries, file lists, or review notes.
- Post inline comments **only** for confirmed `P0`–`P2` defects (never for `Q5.1` verification gaps alone or `P3` nitpicks).
- Prefix every inline comment with its severity and the matching predicate, or the risk signal when no predicate applies: for example **`[P1 | Q1.1]`**, **`[P2 | Q2.2]`**, or **`[P1 | risk/bug-or-logic-error]`**.
- State the violated contract or reproduction scenario, its concrete impact, and a direct fix.
- Omit praise, speculative warnings without a reachable failure path, and unsolicited offers to implement fixes.
