# Dify Agent local capacity benchmarks

The harness measures one fixed Agent capacity unit (`2 vCPU / 2 GiB`, one
Uvicorn worker) with either:

- `local-runtime`: local Agent, local shellctl Runtime, local Redis, and
  deterministic fake dependencies.
- `local-e2b`: local Agent, real E2B, local Redis, and the same deterministic
  fake dependencies.

The capacity results are local references. They are not SaaS SLOs, production
capacity promises, or quotas.

Locust provides the isolated per-worker load lifecycle and diagnostic request
statistics. The benchmark harness continues to own Dify-specific Run/SSE
validation, deterministic dependency ledgers, Runtime/E2B cleanup, Docker
resource sampling, Redis snapshots, and the public result schema. Locust runs
in a child process so its gevent runtime cannot patch the parent asyncio
driver.

## Run

```bash
make -C dify-agent bench-local-runtime

BENCH_E2B_API_KEY=<secret> \
BENCH_E2B_TEMPLATE=<template> \
BENCH_E2B_MAX_CONCURRENCY=20 \
make -C dify-agent bench-local-e2b
```

Both commands run `basic`, `shell`, `resume`, `config`, and a 16 MiB `file`
roundtrip at concurrency 1, 10, and 20. Each point warms up for 15 seconds,
then admits Runs during a fixed 60-second measurement window. The driver waits
for already admitted Runs to finish. Sample count is reported but is not a
validity gate.

For focused debugging:

```bash
make -C dify-agent bench-local-runtime \
  BENCH_SCENARIO=shell BENCH_CONCURRENCY=10
```

A filtered invocation records `matrix_complete=false`.

## Derive ACU and E2B calculator inputs

Use an existing `local-e2b` capacity result without rerunning the workload:

```bash
make -C dify-agent bench-sizing \
  CAPACITY_RESULT=/absolute/path/to/result.json \
  MONTHLY_RUNS=10000000 \
  PEAK_RPS=20 \
  E2B_CONCURRENCY=20
```

`local-runtime` is correctness and local-capacity validation only. Its original
`report.md` is the final output; `bench-sizing` rejects a `local-runtime`
result because production ACU and E2B inputs must come from the same
`local-e2b` capacity path.

Each scenario uses its highest-throughput `valid` point, with lower concurrency
winning a tie. Invalid and saturated points remain visible as diagnostics but
never enter the calculation.

The command creates `sizing-input.json`, `sizing-result.json`, and
`sizing-report.md`. For each pure scenario it reports:

- `Required ACU = ceil(PEAK_RPS / selected runs/s)`, without a safety factor.
- E2B `vCPUs`, from lifecycle `vcpu_count`.
- E2B `RAM (GB)`, from lifecycle `memory_mb / 1024`.
- E2B `Run Hours / Month = active-seconds/run × MONTHLY_RUNS / 3600`.
- E2B concurrency, copied from the business-selected official option:
  `20`, `100`, `600`, or `1100`.

These are the four inputs accepted by the official
[E2B Workload Pricing Estimator](https://pricing.e2b.dev/). The Harness does
not calculate usage amounts, plan fees, add-ons, totals, Enterprise terms, or
credits. Concurrency is a business demand input; it is not inferred from local
test concurrency or peak RPS. Historical results without lifecycle vCPU or
memory fields retain their ACU result but mark E2B inputs `incomplete`.

## Metrics

The main report uses:

- Agent `CPU-ms/run`.
- Agent absolute working-set `MiB peak @ concurrency`.
- E2B vendor lifecycle `active-seconds/run`.
- Redis `commands/run`.
- Agent container `KB/run` (RX + TX, 1 KB = 1000 bytes).
- terminal end-to-end `p95 ms`.
- successful `runs/s`.

E2B running time and resource size are lifecycle evidence used to populate the
official estimator inputs.
Container network traffic is not necessarily cloud billable egress.

## Results

```text
benchmarks/results/<timestamp>-<mode>/
├── result.json
├── report.md
├── samples.jsonl
├── environment.json
├── docker-stats.jsonl
├── redis-stats.json
├── blocks/
└── logs/
```

Each block also retains `locust-warmup-stats.json`,
`locust-measurement-stats.json`, `load-engine.json`, and a redacted worker
context summary. Actual Binding references and session snapshots are passed
through a private temporary directory and are removed when the block ends.
The child process appends observations and active-Run lifecycle events to
line-buffered private journals. If the child is interrupted, the parent uses
those journals to cancel and drain admitted Runs before Runtime/E2B cleanup.
For `local-e2b`, the disposable Driver also fsyncs allocation lifecycle events
to a host-mounted private journal. The host kills any allocation that lacks a
matching destroy event, removes the journal after successful cleanup, and
retains only allocation counts as public evidence.

`valid`, `saturated`, and `invalid` describe only the measured point. Saturation
at c10/c20 is retained as capacity evidence. Startup, correctness, SSE replay,
ledger, resource coverage, or cleanup failures make the command fail.

The E2B API key is read only from the environment and is redacted from every
text artifact. Every worker owns one Binding/Sandbox, and all allocations are
destroyed even when `KEEP_CONTAINERS=1`. Failed `local-e2b` Compose projects
are always removed because retaining their containers would expose the key via
Docker inspection; `KEEP_CONTAINERS=1` only retains failed `local-runtime`
projects.
