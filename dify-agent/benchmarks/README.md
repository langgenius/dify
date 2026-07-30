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
