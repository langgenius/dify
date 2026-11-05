# 1.18.0-fix.7 tracing upgrade

This hotfix starts from `hotfix/1.18.0-fix.6` at
`9a630070eac07d3f477f7f59c7d7c6b5f6569b12` and backports the unified tracing
pipeline from Dify #44673 (`43d8c3715a9067fca7fdbe6f24a5d75732a8076e`), followed
by the Langfuse OTLP changes in #45606. It is a pipeline upgrade, including a
database migration, rather than a standalone provider replacement.

#45606 is included through head `dea90f8a857dc43f1811eb6b021666c0732a5f11`
(three source commits). It was still open when backported; this branch does not
merge it into main. The hotfix retains the existing conversation-name and
suggested-question service owners while connecting them to the new trace scopes.

Use the Dockerfile's uv version, `0.8.9`, for lockfile verification and environment
installation. Validate actual workspace package installation as well as tests:
all nine trace distributions and ten provider entry points must load, including
when installed with `--frozen --no-dev --no-editable` as in the image build.

## Database revision

The hotfix migration is `1e1800070001`, directly after the existing hotfix head
`b9d3f7a5c102`. Its tracing configuration cleanup and unique-index behavior are
backported from main's `53c10126d551` migration.

Main's migration has five intervening ancestors absent from 1.18.0-fix.6. Those
unrelated migrations are not included here, and the main revision identifier is
not reused: stamping the hotfix database with `53c10126d551` would incorrectly
claim that those main ancestors had run.

Before executing this migration, inspect and back up duplicate tracing
configurations. It retains the newest configuration per tenant, application and
provider (by `updated_at`, then ID), deletes the others, and creates the unique
index. Downgrade removes the index; it cannot restore deleted configurations.

A later move from this hotfix to a main-line release requires an explicit
migration reconciliation plan. The main migration repository must recognize the
hotfix revision and account for the missing ancestors. Do not work around an
unknown revision by stamping main's tracing revision or head.

## Worker rollout

The new pipeline uses `OPS_TRACE_QUEUE`, defaulting to `ops_trace_v2`. Explicit
worker queue selections still override the default queue list and must include
the new queue on tracing workers.

Drain legacy `ops_trace` tasks using the old worker version before moving its
workers. Keep new workers off the old queue: the retired task entry point in the
new version deletes legacy payloads without exporting them. Do not redirect the
new pipeline onto `ops_trace` during a mixed-version rollout.

## Acceptance

Before rollout, verify the migration revision and duplicate cleanup, the API and
worker queue settings, and the fixed image digests. Exercise a normal Workflow
and an Agent Workflow through the configured providers, checking parent links,
timestamps, usage, costs, and provider acknowledgment/retry behavior. Langfuse
exports use `POST /api/public/otel/v1/traces` with protobuf rather than the legacy
ingestion endpoint; proxies must permit that route and content type.

Repository tests and image builds do not constitute a production migration or
provider-delivery acceptance. This branch preparation does not execute a
production migration or change deployment configuration.
