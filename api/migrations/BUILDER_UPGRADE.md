# Builder empty merge consolidation

The feature branch consolidates five historical empty merge revisions into the
retained final merge `7d95a2e61346`. Schema-changing revision IDs and bodies,
upstream/main history, and retained ancestor dependencies are preserved.

The observed Local checkpoint `6c84f1d90235` and Dev checkpoint
`7d95a2e61346` support ordinary forward upgrades without restamping.

The 2026-11-19 main sync adds a separate empty merge, `430a56d97885` (parents
`c34e2f7b5a10` and main's `f8b6e2c4a901`), as the single head. It is not part of
this consolidation; from either checkpoint, or from `c34e2f7b5a10`, an ordinary
`flask upgrade-db` first runs main's Evaluation, personal access token and file
scan revisions, then the merge.

## Environments at a removed checkpoint

Before installing this cleanup, inspect `flask db current` through the normal
deployment migration tooling. If any version row contains one of these IDs,
first upgrade using the pre-cleanup checkout:

- `733e4c46f90e`
- `f9a3c62de418`
- `a61e9b2c7d40`
- `d41e6b8c2a75`
- `db7f42c9a801`

Keep checkout `88f64b6a3b08a7ec2919221af75152d7a360a0c9` with its normal
configuration and dependencies, run the ordinary `flask upgrade-db`, and verify
that only `7d95a2e61346` remains before installing the cleanup checkout. This
also applies to multihead checkpoints containing a removed ID.

If the cleanup was installed first, restore the old checkout to perform that
normal upgrade. Do not stamp, directly edit `alembic_version`, reset the
database, or assume that a missing revision's dependencies already ran.

Deleted IDs are no longer directly resolvable by the new script directory.
Environments requiring direct upgrades from every historical ID must retain
the pre-cleanup migration files until they have completed this prior upgrade.
