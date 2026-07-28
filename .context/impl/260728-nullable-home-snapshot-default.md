# Nullable Home Snapshot and Backend Default Home — Implementation Note

## Result

Home Snapshot is now an optional immutable checkpoint rather than a prerequisite
for creating an Agent.

An Agent config whose `home_snapshot_id` is `NULL` creates its first Execution
Binding from the selected backend's deployment-default Home. No logical
`AgentHomeSnapshot` row or physical immutable snapshot is created for that
default. A real snapshot is still created when Build Draft Apply checkpoints the
participant's current Materialized Home.

## Major additions

### Nullable API data flow

- `AgentConfigDraft.home_snapshot_id`,
  `AgentConfigSnapshot.home_snapshot_id`, and
  `AgentWorkspaceBinding.base_home_snapshot_id` are nullable in the ORM and
  database schema.
- Agent creation, backing-Agent creation, Composer recovery, Workflow-only
  creation, DSL import, and clone paths seed config versions with
  `home_snapshot_id=None` without contacting Dify Agent.
- Publish and config-version propagation preserve `None`. Explicit logical
  snapshot ids are still resolved against the tenant, Agent owner, and active
  ledger state.
- `AgentWorkspaceService` passes `home_snapshot_ref=None` to Dify Agent when the
  config has no checkpoint. It does not query the snapshot ledger or manufacture
  a placeholder id.
- Agent App, Workflow Agent, preview, and Build Draft callers carry the nullable
  generation through their session and Binding paths.
- Build Draft Apply accepts a Binding whose base snapshot is `None`, creates an
  immutable checkpoint from that exact Binding, records the resulting
  `AgentHomeSnapshot`, and assigns its logical id to the normal draft.

### Backend-default Home contract

- `CreateExecutionBindingRequest.home_snapshot_ref` and
  `ExecutionBindingCreateSpec.home_snapshot_ref` accept `None`.
- The backend protocol documents that `None` means an independent mutable
  deployment-default Home, while a non-empty ref must be materialized exactly
  and must never fall back.
- Local creates an empty per-Binding Home for `None`; explicit snapshots are
  validated before lease allocation and before Workspace/Home writes.
- E2B creates the Sandbox from the configured E2B template for `None`, and from
  the explicit snapshot ref otherwise. The template is owned by the Execution
  Binding backend rather than the snapshot backend.
- Enterprise creates a default Sandbox through `POST /v1/sandboxes`, initializes
  the canonical Home and empty Workspace through shellctl, and returns the
  Sandbox id as the Binding and Workspace refs. Explicit immutable snapshots and
  shared Workspace attachment remain fail-fast unsupported.

### Linear schema convergence

- Historical revision `2f39536b3feb` now adds the draft, snapshot, and
  intermediate runtime-session fields as nullable, so a database with existing
  rows can reach later revisions.
- Historical revision `f6e4c5686857` now creates the Binding base snapshot field
  as nullable and recreates the intermediate field as nullable on downgrade.
- Generated linear revision `e4708db55c1d` alters the three current fields to
  nullable for databases that already executed the former NOT NULL revisions.
  On a fresh corrected chain, the repeated alters are intentional schema
  convergence.
- No rows are backfilled and no migration calls an external runtime backend.

## Major deletions

- Removed `AgentHomeSnapshotService.create_initial()`.
- Removed `InitializeHomeSnapshotSpec`,
  `InitializeHomeSnapshotRequest`, `HomeSnapshotBackend.initialize()`, the
  `/home-snapshots/initialize` route and server method, sync/async client
  methods, backend implementations, exports, fixtures, and tests.
- Removed the temporary E2B initialization-Sandbox flow.
- Removed unused Enterprise HomeSnapshot Gateway configuration and unreachable
  exception branches left behind by the old initialization design.
- Removed documentation that described an initial/baseline snapshot or a
  temporary Home initialization resource.

## Review-driven refinements

- Local validates an explicit snapshot before allocating an operation lease or
  mutating Home/Workspace resources.
- Tests independently cover owner routing and nullable generation instead of
  coupling the two parameter dimensions.
- The migration suite includes both a fresh pre-`2f39536b3feb` upgrade and an
  old-`f6e4c5686857` NOT NULL convergence case.
- Publish, full Build Draft Apply, API explicit-snapshot fail-fast, and Local
  validation-before-write behavior have direct regression coverage.
- Dead snapshot fixtures, duplicate assertions, incidental call-order
  assertions, unused backend configuration, and unreachable guards were
  removed.

## Differences from the proposal

There is no intentional product or architecture deviation from the proposal.
The implementation keeps the proposed limits:

- `NULL` does not create a logical or physical snapshot.
- Invalid explicit snapshot ids and refs fail fast without fallback.
- No new lifecycle states, compatibility layer, sentinel ids, or snapshot
  backfill were introduced.
- Enterprise supports the required default-Home Binding path but does not claim
  immutable snapshot support.

Generated API/frontend artifacts were not changed because the removed
Home-Snapshot initialization surface is private to the Python Dify Agent client
and server and has no repository generation target.

## Verification

- Alembic: one linear head, `e4708db55c1d`.
- Final focused API regression suite: `231 passed`.
- Final focused Dify Agent protocol/backend suite: `103 passed`.
- Dify Agent backend/profile review fixes: `64 passed`; `make check` passed.
- Focused changed-production-module type checks passed during review.
- `git diff --check` passed.

Not run locally:

- CI-only PostgreSQL/MySQL migration jobs.
- Live E2B template integration.
- Live Enterprise Gateway integration.

The full Dify Agent typecheck still reports repository baseline and missing
optional-dependency errors outside the changed production modules; those were
not expanded into this implementation.
