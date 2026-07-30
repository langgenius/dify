# Local Docker Agent, Runtime, and capability A/B benchmarks

This harness compares baseline and candidate code on one local Docker Engine
with deterministic dependencies. It has three independent profiles:

| Profile | Measured boundary |
| --- | --- |
| `agent` | FastAPI Agent service, scheduler, runner, Redis, and fake model/tool |
| `runtime` | Direct shellctl HTTP, shellctl-runner, tmux, SQLite, and filesystem |
| `capability` | Agent through local Runtime and Agent Stub for Shell, Config, Drive, and files |

The local Runtime profile measures the same shellctl data plane that runs inside
an E2B sandbox. It does not measure E2B create/connect/pause/kill/snapshot,
platform HTTPS latency, billing, or production capacity.

Capability detects both Agent runtime contracts. Current builds use an
execution binding plus the `dify.runtime` layer; releases without
`/execution-bindings` use the legacy `dify.shell` provider directly against the
same shellctl container. The selected contract is part of the measured
production code, while the workload and Runtime data plane stay unchanged.

## Commands

```bash
# Existing Agent profile
make -C dify-agent bench-docker-smoke
make -C dify-agent bench-docker-ab

# Direct shellctl Runtime profile
make -C dify-agent bench-docker-runtime-smoke
make -C dify-agent bench-docker-runtime-ab

# Agent -> Runtime capability profile
make -C dify-agent bench-docker-capability-smoke
make -C dify-agent bench-docker-capability-ab

# Single-version Local capacity curve (24 workload/concurrency points)
make -C dify-agent bench-docker-capacity TARGET_REF=1.16.1
```

All A/B commands accept `BASE_REF`, `CANDIDATE_REF`, `BENCH_SCENARIO`,
`BENCH_QUICK=1`, and `KEEP_CONTAINERS=1`. The capability command can pin one
component while comparing the other:

```bash
# Compare only Runtime; use one Agent build on both sides.
make -C dify-agent bench-docker-capability-ab PIN_AGENT_REF=<ref>

# Compare only Agent; use one Runtime build on both sides.
make -C dify-agent bench-docker-capability-ab PIN_RUNTIME_REF=<ref>
```

`PIN_AGENT_REF` and `PIN_RUNTIME_REF` are mutually exclusive. With no
`CANDIDATE_REF`, component-specific tracked and untracked production inputs in
the current worktree are included. Baselines and explicit candidates are built
from `git archive`.

`BENCH_QUICK=1` reduces warmup and measurement to one and two operations. It is
only a wiring/correctness aid, not a performance result.

Smoke commands run one operation of the default scenario. Set
`BENCH_SCENARIO=<scenario-id>` to select another scenario, or `FULL_SMOKE=1` to
use that scenario's configured warmup and measurement window.

## Deterministic scenarios

Agent keeps the original five workloads unchanged. Runtime adds no-op, 1 MiB
output, 1000×4 KiB files, a 16 MiB file, and concurrency 10. Capability adds
Shell no-op/resume, Config pull (3 skills and 10 files), Drive pull, 16 MiB
signed upload/download, and Shell concurrency 10.

Each ABBA block owns a fresh Compose project and named volumes. Runtime jobs use
unique benchmark directories. After measurement, the driver deletes jobs and
the orchestrator verifies that SQLite rows, tmux sessions, job artifacts,
materialized Homes, Workspaces, and benchmark files do not remain.

The local capability topology explicitly grants Runtime Landlock write access
to its benchmark-only `/mnt/drive` volume. That fixed setting is part of the
environment fingerprint, and the volume is checked for residue after every
block.

## Results

Artifacts are written under the ignored
`dify-agent/benchmarks/results/<timestamp>-<profile>-*/` directory:

- v3 baseline/candidate results and component identities
- `comparison.json` and a compact `comparison.md`
- all operation samples
- raw Docker Engine stats
- Redis before/after snapshots where applicable
- Runtime cleanup state and service logs

The Markdown headline is intentionally limited to correctness, p95 start and
Runtime overhead, throughput, CPU per successful operation, memory GB-seconds
per successful operation, and useful file throughput. Capability reports Agent
and Runtime costs separately and as a total.

Network, block I/O, peak PID, peak memory delta, Redis commands, shell jobs, and
Stub calls remain diagnostic JSON. A changed shell-job, Stub-call, or Redis
command mix is a `behavior_change`, not a performance regression by itself.

Performance signals are report-only:

- p95 Runtime overhead: candidate is over 10% and over 1 ms slower
- operations/s or useful payload MiB/s: candidate is over 10% lower
- CPU/op or memory GB-s/op: candidate is over 10% higher
- a confidence interval crossing zero: `inconclusive`

Latency uses blocked bootstrap across the paired ABBA samples. Metrics that
exist only once per block use the direction of both A/B block pairs instead of
manufacturing a confidence interval from two aggregates. If baseline and
candidate have identical production-input hashes, measured deltas can only be
`no_regression` or `inconclusive`.

Fake response p99 includes model, tool, and Agent Stub requests. It is
diagnostic; a material A/B increase or Fake CPU saturation invalidates the
environment, rather than treating a large deterministic file transfer as an
Agent regression.

Startup, terminal state, SSE/output integrity, ledger bytes/checksums,
comparability, and explicit Runtime cleanup are correctness gates and return a
non-zero status.

Only compare baseline and candidate from the same invocation. Local Docker
results are deterministic code A/B evidence, not an E2B cost or SaaS capacity
forecast.

## V2 capacity and real E2B calibration

Capacity mode is separate from the v3 A/B result schema. It writes a v1
single-target curve for concurrency `1/5/10/20`. A full Local point uses three
blocks; every block runs for at least 60 seconds and completes at least 100
successful operations, with a five-minute maximum. `BENCH_QUICK=1` verifies
wiring only and always writes `reference_valid=false`.

Run real E2B calibration only after the Local result exists:

```bash
export BENCH_E2B_API_KEY=<secret>
export BENCH_E2B_TEMPLATE=<template>
export BENCH_E2B_MAX_CONCURRENCY=<vendor-limit>
export BENCH_E2B_MAX_INVENTORY=<approved-inventory-limit>
export BENCH_PILOT_TENANT_COUNT=<count>

make -C dify-agent bench-e2b-capacity TARGET_REF=1.16.1
```

The API key is accepted only through the environment. It is excluded from
settings representations, result JSON, environment fingerprints, and persisted
driver/service logs. The command fails before Docker startup when any required
E2B input is missing. `CAPACITY_RESULTS_DIR=<path>` can select a specific Local
capacity directory; otherwise the latest Local capacity pointer is used.

The E2B command first runs a one-operation lifecycle contract smoke, then
measures two five-wave lifecycle blocks and two Agent-through-E2B service
blocks at every concurrency level. Every worker owns one Binding/Sandbox and
reuses only that Binding during warm measurements. All registered resources are
destroyed through an idempotent cleanup path on success or failure.

The completed capacity directory contains:

- `local-capacity.json` and `e2b-capacity.json`
- `unit-consumption.json` normalized per 1,000 successful Runs
- `quota-recommendation.json` using the fixed 50% launch headroom policy
- `capacity-report.md`, combined samples, environment fingerprints, and logs

`e2b_active_seconds_per_1000_runs` is a measured active wall-time window, not
vendor-billed seconds. Local Runtime CPU/memory is never converted into E2B or
SaaS cost. Binding inventory remains independent of Run count:
`e2b_inventory_units_per_1000_bindings` is always 1,000.

High-concurrency throttle, timeout, or completion loss is reported as
`saturated`; c1 correctness, event/ledger damage, startup failure, or incomplete
cleanup returns non-zero. Quick/smoke evidence never generates a launch quota.
