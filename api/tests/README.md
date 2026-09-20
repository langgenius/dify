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

Durations include setup, call, and teardown. Shared fixture startup is charged to
the test that triggered it, so the estimate cannot perfectly predict a different
execution order, runner contention, or wall-clock time. The snapshot is a hint;
it never determines which tests exist or whether they should run.

Each successful integration shard writes its actual phase totals with
`--write-test-durations`. API Coverage merges the four reports, rejects duplicate
test IDs across shards, and uploads `api-integration-duration-history`.

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
