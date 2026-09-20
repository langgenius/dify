# API test sharding

CI keeps three count-based unit-test shards and four duration-based integration
shards. Integration tests run in CI; do not start their Docker services just to
refresh timing data locally.

`--shard-durations` reads `integration-test-durations.json`, a versioned snapshot
shared by all runners and xdist workers. Tests are assigned longest-first to the
shard with the least estimated work, then executed in their original collection
order. New tests use the median duration of known collected tests; deleted tests
are ignored. An empty snapshot preserves round-robin assignment. Unit tests do
not pass this option and retain their existing assignment.

Weights include setup, call, and teardown, minus shared fixture initialization.
The timer measures session/package/module/class fixture setup in each worker and
sends it with the pytest phase report. Nested shared initialization is counted
once. Function-scoped setup and all teardown, including per-test database cleanup,
remain in the weight. This avoids treating whichever test initializes a worker's
containers as an intrinsically slow test.

Shared initialization remains real work paid by each worker that uses the fixture;
it is kept in the profile for diagnostics rather than charged to an individual
test. Collection/import overhead, shared teardown, contention and different fixture
usage can still affect the longest shard. The snapshot is a hint, not a wall-clock
prediction; it never determines which tests exist or whether they should run.

Each successful integration shard writes setup/call/teardown/shared-setup totals
with `--write-test-durations`. API Coverage merges the four reports, rejects duplicate
test IDs across shards, and uploads `api-integration-duration-history`. That artifact
contains the normalized `integration-test-durations.json` and the unadjusted
`integration-test-profile.json` for inspecting the amount subtracted.

To refresh the snapshot after a representative successful Main CI Pipeline run:

```sh
gh run download <run-id> --repo langgenius/dify \
  --name api-integration-duration-history --dir /tmp/dify-integration-durations
cp /tmp/dify-integration-durations/integration-test-durations.json \
  api/tests/integration-test-durations.json
```

Commit the snapshot and compare the slowest integration shard, shard spread, and
API completion time in the next CI run. Keep runner sizes, worker counts, and test
selection fixed when evaluating the change. Do not infer a speedup from predicted
loads alone or compare total pipelines that execute different optional jobs.
