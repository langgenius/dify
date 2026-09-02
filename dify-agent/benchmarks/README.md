# Dify Agent capacity benchmarks

The harness measures one fixed Agent capacity unit (`2 vCPU / 2 GiB`, two
Uvicorn workers) with either:

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

## Local run

```bash
make -C dify-agent bench-local-runtime

BENCH_E2B_API_KEY=<secret> \
BENCH_E2B_TEMPLATE=<template> \
BENCH_E2B_MAX_CONCURRENCY=20 \
BENCH_E2B_PUBLIC_STUB_BASE_URL=https://<agent-stub-host>/agent-stub \
BENCH_E2B_PUBLIC_FILES_BASE_URL=https://<files-host> \
make -C dify-agent bench-local-e2b
```

The `local-e2b` File workload additionally requires two temporary HTTPS
endpoints reachable from E2B. A stable development tunnel can route them to
the loopback-only ports exposed for that workload:

```text
https://<agent-stub-host>/agent-stub -> http://127.0.0.1:15050/agent-stub
https://<files-host>/files/*          -> http://127.0.0.1:15002/files/*
```

Run the focused File integration with:

```bash
BENCH_E2B_API_KEY=<secret> \
BENCH_E2B_TEMPLATE=<template> \
BENCH_E2B_MAX_CONCURRENCY=1 \
BENCH_E2B_PUBLIC_STUB_BASE_URL=https://<agent-stub-host>/agent-stub \
BENCH_E2B_PUBLIC_FILES_BASE_URL=https://<files-host> \
make -C dify-agent bench-local-e2b BENCH_SCENARIO=file BENCH_CONCURRENCY=1
```

The Harness rejects missing, non-HTTPS, credential-bearing, or query-bearing
public URLs before it probes Docker or creates any Compose/E2B resources. Only
the File point loads the public endpoints; `local-runtime` and the other
`local-e2b` scenarios retain their existing data paths. Override the loopback
ports with `BENCH_E2B_PUBLIC_STUB_HOST_PORT` and
`BENCH_E2B_PUBLIC_FILES_HOST_PORT` if necessary. Tunnel credentials belong only
to the tunnel process and must not be passed to the Harness.

Both commands run `basic`, `shell`, `resume`, `config`, and a 16 MiB `file`
roundtrip at concurrency 1, 10, and 20. Each point warms up for 15 seconds,
then admits Runs until the measurement has lasted at least 60 seconds and
produced at least 100 attempted Runs. Measurement admission is capped at 360
seconds, after which a sample shortfall invalidates the point. The driver waits
for already admitted Runs to finish. Capacity failures use a 99% success target;
dependency ledger, SSE replay, payload integrity, lifecycle evidence, and
cleanup remain strict correctness requirements where any failure invalidates
the point.

The Config workload pulls three Skills and ten Files through the real Agent
Stub HTTP contract, then hashes every run-unique materialized Workspace file
inside the same Run. In `local-e2b`, each worker Sandbox hosts a deterministic
localhost Config stub; every run-scoped item may be pulled exactly once, and
duplicate or out-of-range pulls fail the Run. The final digest therefore proves
that the fixed three Skills and ten Files were each materialized with the exact
bytes, without depending on a public tunnel. The File workload writes its fixed
payload inside the Runtime and exports it through
`POST /execution-bindings/files/download`; the Driver resolves the canonical
reference through the current inner File API, downloads it, and verifies the
exact size and SHA256. In `local-runtime` the 16 MiB payload stays on the Docker
data path. In `local-e2b` the Sandbox upload/download leg uses the explicit
temporary HTTPS endpoints above. Treat tunneled File results as integration
evidence rather than formal capacity data because the tunnel can be the
bottleneck.

For focused debugging:

```bash
make -C dify-agent bench-local-runtime \
  BENCH_SCENARIO=shell BENCH_CONCURRENCY=10
```

A filtered invocation records `matrix_complete=false`.

## Staging public Service API c1 smoke

This smoke follows the real user entrypoint from one local Locust User:

```text
local Locust -> public edge -> POST /v1/chat-messages -> Dify API -> Agent -> Runtime/E2B
```

It serially runs `basic -> shell -> config` in one conversation and then
deletes that conversation through the public Service API. The deterministic
plugin reads a canonical `DIFY_BENCHMARK_REQUEST` envelope from each user
query. The Config turn explicitly pulls three Skills and ten Files and verifies
13 items, 53,248 bytes, and the checked-in SHA256.

The result uses Schema v3 with `mode=staging-public-e2e`,
`smoke_only=true`, `confidence=low_confidence`, and capacity
`not_applicable`. It does not contain Kubernetes, Agent process, Redis, E2B
lifecycle, Sandbox, shared-infrastructure, cost, SLO, or capacity data.
Conversation deletion is observable; physical Sandbox collection is not.

### Local preparation

Build the deterministic Config fixtures and plugin package locally:

```bash
make -C dify-agent bench-staging-fixtures

make -C dify-agent bench-staging-plugin-package \
  STAGING_PLUGIN_PACKAGE="$PWD/dify-agent/benchmarks/build/staging/dify-agent-benchmark-model-0.1.4.difypkg"
```

The plugin release version is `0.1.4`; its `meta.version` remains `0.0.1`.
Install or upgrade it only in the Benchmark Tenant and keep the non-secret
Benchmark provider credential set to `Enabled`. The Service API key is read
only from `BENCH_STAGING_API_KEY`; it must never be passed as an argument,
committed, logged, or stored in an artifact.

### Explicitly confirmed execution

The protocol client normalizes the base URL to a trailing `/v1/`, uses only
relative Service API paths, and disables inherited HTTP proxy settings.

```bash
export BENCH_STAGING_API_KEY='<benchmark-service-api-key>'

BENCH_CONFIRM_STAGING_RUN=RUN_STAGING_BENCHMARK \
make -C dify-agent bench-staging-public-smoke \
  BENCH_STAGING_BASE_URL=https://api-staging.dify.dev/v1/
```

Optional `BENCH_RUN_ID`, `BENCH_RESULTS_ROOT`,
`BENCH_CONFIG_EXPECTED_SHA256`, and `BENCH_STAGING_PLUGIN_PACKAGE` override
the invocation ID, output root, expected Config digest, and package-evidence
path. The package version and SHA in the public report are explicitly labeled
`local_expected_package`; they are not proof of the version installed in
Staging, which must be verified independently before execution. The smoke
writes:

```text
benchmarks/results/<run-id>-staging-public-smoke/
├── result.json
├── report.md
├── samples.jsonl
├── environment.json
├── locust-stats.json
├── cleanup.json
└── logs/
```

The command returns nonzero when any request lacks a single `message_end`,
emits an SSE error, fails marker/Shell/Config integrity, or fails Conversation
cleanup. One sample per scenario is correctness evidence only, never a
performance-capacity conclusion.

### Public E2E replica-scaling experiment

The Staging experiment measures the shared public user path and whether changing
only `dify-agent-backend` from one to two to four replicas produces a directional
throughput gain. It does not duplicate the component-capacity conclusions from
`local-runtime` or `local-e2b`, and it cannot isolate API, Redis, Plugin, E2B, or
edge bottlenecks.

Each replica stage is an independent, explicitly confirmed command. The
asymmetric matrix is:

| Agent replicas | `basic` | `shell` | `config` | `file` |
|---:|---|---|---|---|
| 1 | c1/c10/c20/c30/c40/c60/c80/c120/c160 | c1/c10/c20 | c1/c10/c20 | c1/c10/c20 |
| 2 | c1/c10/c20/c30/c40/c60/c80/c120/c160 | c10 | c10 | not run |
| 4 | c1/c10/c20/c30/c40/c60/c80/c120/c160 | c10 | c10 | not run |

Every point has one block. `basic` stops after the first suspected boundary and
does not repeat it. `shell` and `config` verify the real Runtime path and
multi-Pod correctness; they do not determine the replica-scaling throughput.
The R1-only File workload creates a deterministic 16 MiB payload, uploads it as a
conversation-owned ToolFile, downloads its public URL inside the Sandbox, and
requires exact byte count and SHA256. File c10/c20 run only after c1 proves both
transfer correctness and physical file cleanup; any correctness or cleanup
failure stops the remaining File points.
Every User owns one end user and Conversation, setup is limited to one User per
second, and all Users pass a setup barrier before the 15-second warmup. Warmup
is drained and discarded before a 60-second closed-loop measurement; admitted
requests may drain for at most 180 seconds.

Before a stage, the operator must use GitOps to disable auto-sync only on the
`staging-agent-backend` child Application and manually scale the Deployment to
the requested replica count. The Harness is read-only with respect to Argo and
the Deployment: it verifies the child is paused, the parent remains automated,
the desired/updated/ready/Endpoint counts match, Pods are placed on distinct
nodes with zone skew at most one, and every Pod retains the same image digest,
`2 vCPU / 2 GiB`, two workers, and zero restarts. It never patches Argo or scales
the Deployment.

The E2B count observer is a bounded local subprocess beside Locust. It reads
the E2B API key only from its own environment, polls the Vendor inventory once
per second, and writes only running/paused counts to public artifacts. Sandbox,
Binding, Workspace, Tenant, Agent, and credential values stay out of the
public tree. No Kubernetes Job, observer image, or Secret mount is created.

Run one stage only after its replica deployment and cleanup prerequisites have
been manually verified:

```bash
export BENCH_STAGING_API_KEY='<benchmark-service-api-key>'
export BENCH_E2B_API_KEY='<e2b-api-key>'

BENCH_CONFIRM_STAGING_RUN=RUN_STAGING_BENCHMARK \
make -C dify-agent bench-staging-public-scaling-stage \
  BACKEND_REPLICAS=1 \
  BENCH_STAGING_BASE_URL=https://api-staging.dify.dev/v1/ \
  BENCH_TENANT_ID='<benchmark-tenant-id>' \
  BENCH_AGENT_ID='<benchmark-agent-id>'
```

Use `BACKEND_REPLICAS=2` and then `4` only after the operator performs and
verifies each manual scale. Optional Kubernetes overrides are
`BENCH_STAGING_KUBE_CONTEXT` and `BENCH_STAGING_NAMESPACE`.
`BENCH_STAGING_SCENARIO` and
`BENCH_CONCURRENCY` select a debug subset; such a Stage result is explicitly
incomplete and cannot support the final scaling comparison.

Conversation deletion belongs to the parent Harness, not the Locust process.
Before DELETE, the parent captures an exact private Workspace/Binding/backend
mapping from Staging DB, then deletes at two Conversations per second and waits
for Conversation, Workspace, Binding, ToolFile rows, exact storage objects, and
matching Vendor inventory to remain zero twice ten seconds apart. Storage
verification uses strict object-store HEAD semantics: only an explicit
not-found result counts as absent; permission, network, and 5xx failures make
the evidence invalid. Private manifests use mode `0600`, stay outside public
artifacts, and are removed only after DB/storage/Vendor reconciliation and
observer cleanup all succeed. DELETE 204 without physical zero evidence fails
the Stage and stops later blocks.

The deployment preflight also requires the `conversation` queue consumer to
load the retrying ToolFile cleanup task and sweeper introduced by product fix
`dfac3e524e` (#40792). A Staging image that still deletes only the ToolFile DB
row, without deleting its storage object, is rejected before any File resource
is created. If cleanup stalls, the parent may re-enqueue the exact soft-deleted
Conversation cleanup task once; it never directly deletes a ToolFile row or
storage object.

Each block first creates a durable `0700` recovery directory under
`BENCH_PRIVATE_RECOVERY_ROOT` (default:
`dify-agent/benchmarks/private-recovery`). A failed or interrupted block retains
its `0600` allocation, DB, and E2B manifests there; the public block artifact
contains only an opaque `recovery-<hex>` handle, never the private directory or
resource identities. To start manual recovery, stop the matrix, locate
`$BENCH_PRIVATE_RECOVERY_ROOT/<handle>/`, and use its
`allocation-journal.jsonl`, `database-targets.json`, and E2B target manifests
as the inputs for an operator-reviewed rerun of the parent DB/Vendor
reconciliation. Do not upload these files or delete the directory until both
inventories are confirmed zero. A subsequent block must not run merely because
Conversation DELETE returned 204.

After all three Stage results exist, aggregate them offline:

```bash
make -C dify-agent bench-staging-public-scaling-report \
  R1_RESULT=/absolute/path/to/r1/result.json \
  R2_RESULT=/absolute/path/to/r2/result.json \
  R4_RESULT=/absolute/path/to/r4/result.json
```

`BENCH_SCALING_OUTPUT_DIR` optionally selects a new, non-existing output
directory. Aggregation validates Schema v7 Stage mode, replica identity,
target/harness/plugin/scenario fingerprints, deployment stability, and public
artifact safety before combining blocks. It performs no network or cluster
operation.

Stage results use `mode=staging-public-e2e-scaling-stage`; the aggregate uses
`mode=staging-public-e2e-scaling`. Both use
`confidence=single_block_shared_traffic`. The aggregate compares only
`T_basic(1)`, `T_basic(2)`, and `T_basic(4)`. Its conclusion is a directional
shared-Staging observation, never an Agent component maximum, E2B capacity,
production SLO, or production concurrency promise.

## Derive ACU and E2B calculator inputs

Use an existing `local-e2b` capacity result without rerunning the workload:

```bash
make -C dify-agent bench-sizing \
  CAPACITY_RESULT=/absolute/path/to/result.json \
  MONTHLY_RUNS=10000000 \
  PEAK_RPS=20 \
  E2B_CONCURRENCY=20 \
  E2B_TEMPLATE_VCPUS=2 \
  E2B_TEMPLATE_RAM_GB=1
```

`local-runtime` is correctness and local-capacity validation only. Its original
`report.md` is the final output; `bench-sizing` rejects a `local-runtime`
result because production ACU and E2B inputs must come from the same
`local-e2b` capacity path.

Each scenario uses its highest-throughput `valid` point, with lower concurrency
winning a tie. Invalid and saturated points remain visible as diagnostics but
never enter the calculation.

The command reads Capacity Result Schema v1 and creates Sizing Schema v2
`sizing-input.json`, `sizing-result.json`, and `sizing-report.md`. For each pure
scenario it reports:

- `Required ACU = ceil(PEAK_RPS / selected runs/s)`, without a safety factor.
- E2B `vCPUs`, from the explicit Template configuration input.
- E2B `RAM (GB)`, from the explicit Template configuration input.
- E2B `Run Hours / Month = active-seconds/run × MONTHLY_RUNS / 3600`.
- E2B concurrency, copied from the business-selected official option:
  `20`, `100`, `600`, or `1100`.

These are the four inputs accepted by the official
[E2B Workload Pricing Estimator](https://pricing.e2b.dev/). The Harness does
not calculate usage amounts, plan fees, add-ons, totals, Enterprise terms, or
credits. Concurrency is a business demand input; it is not inferred from local
test concurrency or peak RPS. Lifecycle `vcpu_count` and `memory_mb` cross-check
the configured Template resources when available. Historical results without
those lifecycle fields use the explicit Template inputs and retain a diagnostic
warning; a lifecycle mismatch marks the scenario `incomplete`.

## Metrics

The main report uses:

- Agent `CPU-ms/run`.
- Agent absolute working-set `MiB peak @ concurrency`.
- E2B vendor lifecycle `active-seconds/run`.
- Redis `commands/run`.
- Agent container `KB/run` (RX + TX, 1 KB = 1000 bytes).
- terminal end-to-end `p95 ms`.
- successful `runs/s`.

E2B running time comes from lifecycle evidence. Template vCPU and RAM inputs
populate the official estimator and matching lifecycle resources cross-check
them when available.
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
