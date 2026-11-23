# Builder schema upgrade

Revision `430a56d97885` installs the complete Builder schema after main's
`f8b6e2c4a901`. It creates the final table names, indexes, constraints, and
native execution triggers. It also registers the same final revision as the
previous Builder migration chain.

## Choose the upgrade path

Check the current database revision with the normal migration tooling before
changing the checkout.

- **A database on main or a fresh installation:** run the ordinary upgrade
  with the consolidated migration. Alembic applies main's pending revisions
  before creating Builder storage in one step.
- **A database already at `430a56d97885`:** use the ordinary upgrade. The
  database already has the final Builder schema and Alembic skips the revision.
- **A database at an intermediate Builder revision:** first upgrade with the
  pre-consolidation checkout `239853f233cf4059f6dfcf23c27f042a6e699e30`. Verify
  that the database reports only `430a56d97885` before switching to the
  consolidated checkout. This also applies to databases with multiple
  revision rows when one row contains a retired Builder revision.

Databases that stopped at a merge revision removed by an earlier Builder
cleanup must first use a checkout that still includes that revision. Follow
the [previous upgrade guide](https://github.com/langgenius/dify/blob/239853f233cf4059f6dfcf23c27f042a6e699e30/api/migrations/BUILDER_UPGRADE.md)
before upgrading through the pre-consolidation checkout. Let Alembic advance
the version table through the actual migrations.

## Downgrade

Stop Builder writers before downgrading. The revision checks for pending
native waits, continuation state, dispatch claims, and Code physical evidence
before dropping tables. A successful downgrade removes Builder data and
returns the schema to main's `f8b6e2c4a901` revision.
