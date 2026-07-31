# Dify Agent local capacity benchmarks

The harness measures one fixed Agent capacity unit (`2 vCPU / 2 GiB`, one
Uvicorn worker) with either:

- `local-runtime`: local Agent, local shellctl Runtime, local Redis, and
  deterministic fake dependencies.
- `local-e2b`: local Agent, real E2B, local Redis, and the same deterministic
  fake dependencies.

These results are local capacity references. They are not SaaS SLOs, production
capacity promises, quotas, or monetary cost estimates.

## Run

```bash
make -C dify-agent bench-local-runtime

BENCH_E2B_API_KEY=<secret> \
BENCH_E2B_TEMPLATE=<template> \
BENCH_E2B_MAX_CONCURRENCY=20 \
make -C dify-agent bench-local-e2b
```

Both commands run `basic`, `shell`, `resume`, `config`, and a 16 MiB `file`
roundtrip at concurrency 1, 10, and 20. Each point warms up for 15 seconds and
measures for at least 60 seconds. Basic, Shell, Resume, and Config require 100
successful Runs; File requires 10. A point stops after at most 180 seconds.

For focused debugging:

```bash
make -C dify-agent bench-local-runtime \
  BENCH_SCENARIO=shell BENCH_CONCURRENCY=10
```

A filtered invocation records `matrix_complete=false`.

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

`valid`, `saturated`, and `invalid` describe only the measured point. Saturation
at c10/c20 is retained as capacity evidence. Startup, correctness, SSE replay,
ledger, resource coverage, or cleanup failures make the command fail.

The E2B API key is read only from the environment and is redacted from every
text artifact. Every worker owns one Binding/Sandbox, and all allocations are
destroyed even when `KEEP_CONTAINERS=1`.
