# Local Docker service A/B benchmark

This harness compares two `dify-agent` service builds on the same local Docker
Engine. It uses the real FastAPI server, scheduler, runner, SSE route, Redis
store, and plugin-daemon adapters, but replaces model and tool dependencies with
a deterministic in-network fake. It does not call real model, plugin, or
Knowledge services.

## Run it

From the repository root:

```bash
make -C dify-agent bench-docker-smoke
make -C dify-agent bench-docker-ab
make -C dify-agent bench-docker-ab BASE_REF=<git-ref-or-sha>
make -C dify-agent bench-docker-ab \
  BASE_REF=<baseline-sha> \
  CANDIDATE_REF=<candidate-sha>
make -C dify-agent bench-docker-ab KEEP_CONTAINERS=1
```

The default baseline is `origin/main`. The default candidate is the current
worktree, including tracked and untracked production inputs under
`dify-agent/src` plus `pyproject.toml`, `uv.lock`, and `Dockerfile`.

For a fast harness iteration, run one scenario with reduced trials:

```bash
make -C dify-agent bench-docker-ab \
  BENCH_QUICK=1 \
  BENCH_SCENARIO=single_1_chunk_c1
```

`BENCH_QUICK=1` is a correctness/development aid, not a performance result.

## Read the output

Artifacts are written under the ignored
`dify-agent/benchmarks/results/<timestamp>-*/` directory. The top level contains
the baseline and candidate results, all run samples, a machine-readable
comparison, and `comparison.md`. Each block retains Docker samples, Redis
snapshots, the exact run samples, and Agent/Redis/Fake service logs.

The primary report is intentionally small:

- Correctness separates attempted, admitted, terminal, and successful runs,
  plus deterministic ledger and SSE/Redis replay checks.
- Latency reports create-run p95, time-to-first-event p95, terminal e2e
  p50/p95, and Runtime overhead p50/p95.
- Throughput reports terminal and successful runs/s. Deterministic events per
  successful run remains a workload check rather than a throughput headline.
- Resource efficiency reports Agent and Redis CPU seconds/successful run,
  memory GB-seconds/successful run, Agent peak memory delta, internal network
  bytes/successful run, Redis commands and command mix, and Redis storage.
- Environment validity reports Docker stats boundary coverage and Fake
  dependency CPU/response latency.

Performance classifications are report-only:

- Latency uses block-aware bootstrap without pairing unrelated run ordinals.
- Throughput and resource metrics use the two ABBA pairs descriptively; both
  pairs must cross a regression threshold to report `possible_regression`.
- `possible_regression` highlights a repeatable threshold signal.
- `inconclusive` means local noise prevents a directional conclusion.
- `behavior_change` means Redis commands per successful run increased by at
  least one in both ABBA pairs.

Only startup, comparability, terminal-state, SSE sequence, or fake-ledger
correctness failures return a non-zero exit code. With `KEEP_CONTAINERS=1`, a
failed benchmark-prefixed Compose project is retained for diagnosis; successful
blocks are still cleaned up.

Do not compare separate invocations or machines. The ABBA ordering and clean
Compose project per block are designed only for the paired comparison produced
by a single invocation.
