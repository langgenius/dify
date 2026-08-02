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

## Calculate local-E2B costs

Use an existing `local-e2b` capacity result without rerunning the workload:

```bash
make -C dify-agent bench-cost \
  CAPACITY_RESULT=/absolute/path/to/result.json \
  COST_INPUT=/absolute/path/to/cost-input.json
```

`local-runtime` is correctness and local-capacity validation only. Its original
`report.md` is the final output; `bench-cost` rejects a `local-runtime` result
instead of applying monetary prices to it.

The cost input uses Schema v1. The harness has no built-in E2B, ACU, Redis, or
network prices: every price comes from `COST_INPUT`. Unknown prices must be
`null`; an explicit zero means the resource is free under the supplied
assumptions. When any price is non-null, `currency` and `price_source` are
required. The source should identify the vendor or internal catalog and the
date the price was retrieved.

```json
{
  "schema_version": 1,
  "monthly_runs": 10000000,
  "peak_rps": 20,
  "billing_period_seconds": 2592000,
  "retention_seconds": 0,
  "usage_weights": null,
  "peak_weights": null,
  "billable_egress_ratio": null,
  "e2b_billing": {
    "minimum_seconds": 0,
    "increment_seconds": 1
  },
  "redis_tiers": [
    {
      "name": "example",
      "max_commands_per_second": 100000,
      "max_memory_bytes": 1073741824,
      "max_network_mbps": 1000,
      "monthly_price": null
    }
  ],
  "acu_monthly_price": null,
  "e2b_price_per_billed_second": null,
  "network_price_per_gib": null,
  "currency": null,
  "price_source": null
}
```

Each scenario uses its highest-throughput `valid` point, with lower concurrency
winning a tie. Invalid and saturated points remain visible as diagnostics but
never enter the calculation. If supplied, `usage_weights` and `peak_weights`
must each contain all five scenario names, use non-negative values, and sum to
one; they are never inferred or normalized.

The command creates a new `benchmarks/results/<timestamp>-cost/` directory with
`cost-input.json`, `cost-result.json`, and `cost-report.md`. It reports ACU,
Redis, E2B, and network requirements and costs from the supplied assumptions.
It does not calculate Kubernetes Pod or Node equivalents, model/Tool costs,
quotas, or production SLOs. E2B cost uses per-Run active-time samples and
applies the configured billing quantum before averaging. Markdown values are
displayed with four decimal places while JSON artifacts retain the original
calculation precision.

## Metrics

The main report uses:

- Agent `CPU-ms/run`.
- Agent absolute working-set `MiB peak @ concurrency`.
- E2B vendor lifecycle `active-seconds/run`.
- Redis `commands/run`.
- Agent container `KB/run` (RX + TX, 1 KB = 1000 bytes).
- terminal end-to-end `p95 ms`.
- successful `runs/s`.

E2B active time is measured provider execution time, not vendor billed time.
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
