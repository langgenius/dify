# Workflow storage contracts

Run from the repository root:

```sh
uv run --project api pytest --no-cov -q api/tests/unit_tests/repositories/workflow/storage_contracts
```

`test_behavior.py` runs the same assertions through the configured production
factories and public read/write ports for RDBMS, Celery, and LogStore. The two
storage settings are also tested independently across all nine combinations.
LogStore cases exercise both production SDK and PG client routing.

The contract covers:

- field and creator fidelity, fresh-reader visibility after accepted work is delivered;
- latest-state reads, repeated delivery, tenant/app isolation, trigger/status filters;
- stable `(created_at, id)` pagination and rejection of out-of-scope cursors;
- time-bounded counts and timezone-aware statistics without counting old versions;
- node payload updates, ordering, unfinished nodes, snapshots and full process data;
- histories larger than remote query pages, and runs with more than 100 versions;
- propagation of write failures without exposing failed writes through caches;
- synchronous relational caller rows for participant allocation.
- datasource debug responses and draft variables before asynchronous delivery;
- Celery attempt ordering with microseconds, DATETIME rounding and truncation.
- interleaved Celery and synchronous inserts that retain a single execution ID;
- save, pause, resume and cleanup before log delivery, for scheduling and human input.

The detail/snapshot APIs include paused nodes. Runtime history excludes them.
Ordinary `save` means the write was accepted; it does not promise immediate
log visibility across asynchronous workers. Run identity and lifecycle state
are persisted synchronously for every backend, independently of optional SQL
log copies. `settle()` delivers accepted work before log-read assertions; pause
transactions and node `save_synchronously` are checked before asynchronous delivery.

`test_logstore_policies.py` verifies actual dual writes, graph omission and
explicit migration fallback with real records. The common tests disable fallback
and dual writes so SQL log copies cannot hide a broken LogStore path. Mandatory
SQL control rows remain present, with graph/input/output payloads absent.

`test_archiving.py` exercises the SQL-only archiver against the backend matrix.
LogStore run or node storage is explicitly rejected, including optional dual
writes, because those copies are best-effort. SQL control rows without a graph
payload are also rejected after a backend switch or before Celery delivery.
Rejected bundles publish neither archive objects nor catalog entries; RDBMS and
settled Celery logs remain archivable with their payloads and nodes intact.
After switching node storage back to SQL, each run must also have enough persisted
attempts under the same owner to cover its recorded execution steps. Each node row
represents one attempt; validated, distinct retry entries in its full Process Data
represent the earlier failed attempts. Offloaded Process Data is loaded through
the existing model loader. Duplicate or malformed entries cannot make up missing
attempts. Complete retry histories can be archived alongside normal runs; missing
history is rejected before any archive write. This check does not prove that
every historical payload is complete or identify its original storage backend.

## Adding an implementation

1. Register its finite configuration value and wire its paired readers/writers.
2. Add its name to `BACKENDS` in `harness.py`. A guard compares this registry with
   both configuration fields, so adding a production mode without a driver fails.
   The common cases and the configuration matrix expand from this registry.
3. Supply its external transport and completion mechanism in the fixtures.
   Keep repository construction, mappings and queries real. Do not add
   backend-specific expected values, skip shared assertions, or return canned
   repository responses to make the contract pass.
4. Add separate tests for genuinely backend-specific controls.

## Validation boundary

Relational persistence uses real SQLite sessions. Celery payloads pass through
Kombu JSON serialization and execute the production worker function when delivered.
LogStore writes append to separate SQL tables; reads execute the production SQL,
including window functions, filters and aggregates. Its SDK adapter returns string
cells while PG preserves numeric cells. Only scalar datetime dialect functions
are supplied by the local transport; repository SQL is not rewritten.
The transport explicitly rejects `LIMIT count OFFSET offset`, which SQLite
accepts but SLS does not. This guard covers the known incompatibility; it is
not a complete SLS parser.

`tests/integration_tests/repositories/workflow/test_logstore_dialect.py` submits
the production paginated queries to real SLS using SDK and PG transports, for
both the first and subsequent pages. Run it in CI with the `ALIYUN_SLS_*`
connection settings and an existing project containing the workflow indexes.
It only queries absent owners and performs no writes. Without SLS credentials
it is explicitly skipped; SQLite results do not certify provider compatibility.

Node attempts retain the engine start time at microsecond precision in existing
JSON metadata, independently of relational DATETIME precision. Old rows without
this version only accept state progression within the database's one-second
precision window; ambiguous same-second restarts are not treated as newer attempts.

These tests validate application storage semantics. They do not validate a live
broker, actual SLS indexing latency, provider SQL compatibility, or remote retry
and availability behavior. Those require CI integration infrastructure. Pause
state remains relational and its immediate availability is covered by the
cross-backend contract. Retention/archive operations retain their existing suites;
selecting a log backend does not migrate control state to SLS.
