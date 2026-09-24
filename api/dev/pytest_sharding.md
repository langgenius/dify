# API unit-test sharding

The workflow plans shards before pytest collection. Files with recorded durations
are sorted longest first and assigned to the least-loaded shard. Unseen files are
assigned round robin. File discovery always comes from the current checkout, so
stale history cannot omit new tests or reintroduce deleted files.

Like PyTorch's `tools/testing/test_selections.py`, oversized files become logical
parts. Our default is 60 summed testcase seconds per part, capped at the number of
CI shards. This is worker work, including setup/call/teardown, not wall time; the
threshold corresponds roughly to 30 seconds of work on two workers. Each case's
SHA-256 hash assigns it to one part, including new parametrized cases. Only files
assigned to a runner are collected; shared oversized files are collected on each
assigned runner. All workers use the same frozen plan. Ordinary xdist scheduling
continues inside each runner.

Successful coordinator reports are uploaded as two small timing artifacts. The
public [dify-test-infra](https://github.com/langgenius/dify-test-infra) repository
collects complete observations from successful CI on merged Dify PRs daily at
03:05 UTC. It averages up to five recent samples and publishes `stats/test-times.json`
on its `generated-stats` branch. Metadata records the source runs. No timing data
or generated history is committed to Dify itself.

Every PR, including fork PRs, downloads that same public baseline without a token.
Unmerged PR observations do not update the shared baseline automatically. The
initial baseline is explicitly marked as a bootstrap from validated CI on #42593;
automatic updates use merged PRs only. Keeping the producer in the statistics
repository avoids needing a cross-repository write token in Dify or additional
main-branch test runs.

A single planning job downloads the baseline once and publishes both the input
and assignment plan as run artifacts. All shards therefore use the same snapshot,
even if statistics are updated during a run. Downloads have bounded timeouts and
retries; missing or invalid JSON falls back to round-robin allocation. Successful
unit runs continue publishing observations for the external updater; failed or
incomplete runs are not accepted as baseline samples.

This trades an extra planning job for consistent assignments. Timing noise,
shared fixtures, collection, and an indivisible slow case can still produce
imbalance. Logical splitting can duplicate expensive module/session setup. Compare both
shard test steps and the end-to-end API completion time when evaluating a change.

Local examples (from repository root):

```sh
uv run --project api python api/dev/pytest_sharding.py \
  --shard-index 1 --shard-total 2 --durations /tmp/durations.json \
  --write-plan /tmp/plan.json --ignore api/tests/unit_tests/controllers \
  api/tests/unit_tests api/providers/vdb/*/tests/unit_tests api/providers/trace/*/tests/unit_tests
uv run --project api python api/dev/pytest_sharding.py \
  --shard-index 1 --shard-total 2 --plan /tmp/plan.json api > /tmp/files.txt
uv run --project api pytest --file-shard-plan /tmp/plan.json \
  --shard-index 1 --shard-total 2 --write-test-durations /tmp/durations-1.json \
  @/tmp/files.txt
```

Repeat the last two commands for shard 2. Merge their file durations by addition
before using them as the next history snapshot. Keep generated files outside the
checkout locally.
