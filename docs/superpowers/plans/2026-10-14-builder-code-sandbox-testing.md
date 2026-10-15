# Builder Code Sandbox Testing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver useful native Python, JavaScript and Jinja Builder tests with request isolation, finite resource budgets, cancellation and enforceable network scope.

**Architecture:** Extend the existing sandbox `/v1/sandbox/run` and language runners with a Linux request supervisor, immutable environments and versioned invocation options. Dify supplies these options through per-invocation native collaborators and the shared authorization owner; it retains native transformers and output validation. CodeSandbox qualification and Agent backend test-environment qualification are separate deliverables.

**Tech Stack:** Go 1.24.11, Linux namespaces and cgroup v2, existing seccomp libraries, Python/Node/Jinja, Docker, Pydantic v2, httpx, Graphon 0.7-compatible APIs, normal Linux CI.

**Spec:** `docs/superpowers/specs/2026-10-14-builder-unified-native-testing-design.md`, especially §§3–4, 6 and 8–9. The user approved the written design before this plan was requested.

**Coordinator:** `docs/superpowers/plans/2026-10-14-builder-unified-native-testing.md`: consume C01 common contracts and C03 trusted state/lifecycle implementations; `2026-10-14-builder-native-workflow-testing.md` NW1/NW3 owns runtime ports and typed control/factory composition.

## Global Constraints

- Dify baseline: `13368bd5fa91a613c65ccc1bd328fcadac732cf2`; separate sandbox repository: `/Users/chongbinyao/dify/dify-sandbox`, audited `5631afef06ec88f80c28129aec7fd22a30006b14`.
- Spec §6: “禁止修改进程全局 endpoint/cwd/policy。” Use immutable invocation objects and child-local working directories.
- Spec §6: “保留正常 Python/JS 导入和已安装依赖；额外依赖通过固定环境制品准备，不在测试请求内任意安装/刷新。”
- Spec §6: “输出超限、超时或截断返回明确失败，不能当作部分输出成功。”
- Spec §6: “普通 sandbox endpoint 的行为不因测试服务上线而改变。” Keep legacy requests and deployment behavior compatible.
- Opaque code receives disclosure and confirmation for the immutable invocation, execution identity, input/dependency/data/network scope and bounded counts. Do not infer hidden action semantics from ASTs or create per-plugin manual qualification.
- A confirmation never becomes unrestricted `enable_network=True`; no inherited business credentials, service API keys, Docker socket or unapproved host mounts enter user execution.
- Shared budgets are atomically reserved from the common owner; a child invocation cannot reset root limits. Numeric release budgets are measured against useful language/dependency workloads, not accepted from historical 1/1.5 GiB or 5-second candidates.
- New Dify policy/transport implementations live outside `api/core/`; existing core files receive thin adaptations. Root's native lane owns final `node_factory.py` composition and graph/control propagation.
- This document plans work only. No implementation, tests, builds, CI, services, releases or deployments are run while writing it. Execution commands below are for qualified disposable Linux Docker hosts or normal Linux CI; no host backend/Go runtime tests.
- Preserve old Builder Template/JSON/Gmail v1 contracts and receipts. Do not continue old ENG-1189 Task2 without rebasing requirements and rechecking its assertions.

## Review Focus

1. Concurrent Python/Node requests must not share cwd, writable roots, credentials, descriptors or PID visibility; test serial reuse and cross-tenant parallel execution in CS1/CS5.
2. Output exhaustion, descendant-held pipes, client disconnect and worker death must end with bounded cleanup or quarantined capacity; test CS2/CS5.
3. Dependency/native-library changes and mutable mounted requirements must invalidate qualification before execution; test CS3/CS5/CS6.
4. Approved code may change targets through DNS, redirects, proxies or IPv6; enforce the disclosed network/data scope and reject bypass in CS4/CS5.
5. Recorded results and approval waits must survive native retry/resume without a second dispatch or conversion into successful/default Code output; test CS6 with the common/native lanes.

## Ownership, files and interfaces

Paths in CS1–CS5 are relative to the **sandbox Git repository**. Paths in CS6 are relative to the **Dify Git repository**. Each task ends with its own repository commit during implementation; this planning turn makes no commit.

| Owner | Files and responsibility |
| --- | --- |
| CS1–CS2 sandbox | `internal/core/runner/isolation/{contracts,profile,supervisor,linux,registry}.go`, `cmd/request-worker/main.go`: per-request process/resource/filesystem lifetime; `output_capture.go` and existing language runners: bounded capture and child-local invocation. |
| CS3 sandbox | `internal/core/runner/environment/{manifest,verify}.go`, `dependencies/builder/{python.lock,node-package.json,node-package-lock.json}`, `docker/templates/builder.dockerfile`: frozen useful dependencies. |
| CS4 sandbox | `internal/core/runner/network/{scope,linux}.go`, controller/service adapters: exact enforceable scope, capability binding and revocation. |
| CS5 sandbox | `tests/conformance/`, `.github/workflows/builder-conformance.yml`, `scripts/builder-conformance.sh`: actual-image tests, measurement and authenticated release evidence. |
| CS6 Dify | `api/services/code_execution/{contracts,transport}.py`: shared HTTP owner; `api/services/dify_builder/native_testing/sandbox/{contracts,qualification,executor}.py`: Builder policy/collaborators. Thin existing CodeExecutor/Jinja adaptations. |

Common contracts are owned by the root plan under `api/services/dify_builder/native_testing/`: `contracts.py` defines `NativeTestContextRef`, `OperationKey`, `EffectIntent`, `DispatchPermit`, `ApprovalWait`, `RecordedResult`, `PolicyStop`, `EffectReceipt`, `CheckpointRef`; `authorization.py` owns `EffectAuthorizationService`; `lifecycle.py` owns `NativeTestLifecycleService`.

`NativeTestContextRef(policy_version='builder-native-test-v1', request_id, invocation_id, context_digest)` and `OperationKey(invocation_id, occurrence_path, cursor)` identify the trusted invocation and logical operation. `EffectIntent(key, kind, resource_ref, implementation_revision, account_ref, target, parameters, input_digest, capability_digest)` describes the immutable call. `before_call(*, ref, intent) -> EffectDecision` returns `DispatchPermit | ApprovalWait | RecordedResult | PolicyStop`; `record_outcome(*, permit, outcome, result_ref) -> EffectReceipt` records the observed result. Sandbox transport does not issue grants, choose operation cursors or implement continuation storage.

Root's `control.py` exposes `NativeControlBridge.resolve(*, ref: NativeTestContextRef, decision: EffectDecision) -> DispatchPermit | RecordedResult`; waiting/stopping raises typed native control captured before generic native failure/retry handling. Root's `runtime_contracts.py` exposes `NativeStatePort.store_result(*, ref, key: OperationKey, result: JsonValue) -> str` and `load_result(*, ref, result_ref: str) -> JsonValue`; `state_store.py` implements encrypted storage. CS6 consumes these exact owners.

Sandbox wire options use `schema_version=1` with `execution_id`, `invocation_digest`, `environment_digest`, `profile_digest`, `budget` and `network_scope`. The ordinary endpoint accepts the original language/code/preload/enable_network body. The Builder profile requires the versioned envelope and refuses omitted options; it never infers ordinary mode from malformed Builder metadata.

The supervisor result protocol uses explicit statuses: `succeeded`, `failed`, `cancelled`, `unknown`, `configuration_required`, plus `failure_reason` and `cleanup_state`. Reasons include `input_limit`, `code_limit`, `stdout_limit`, `stderr_limit`, `disk_limit`, `memory_limit`, `cpu_limit`, `pid_limit`, `fd_limit`, `deadline`, `queue_full`, `network_scope`, `environment_mismatch` and `cleanup_failed`. `cleanup_state` is `clean` or `quarantined`; terminal success requires clean completion.

## Task CS1: Request supervisor, isolation profile and finite admission

**Depends on:** approved design; common owner supplies remaining-budget reservations before Dify integration. Sandbox changes are independently testable.

**Files:** Create the CS1 isolation files, `internal/core/runner/network/scope.go` DTO and `cmd/request-worker/main.go`; create `internal/core/runner/isolation/{profile,supervisor}_test.go`; modify `internal/controller/{run,router}.go`, `internal/service/{python,nodejs}.go`, `internal/core/runner/{temp_dir.go,python/python.go,nodejs/nodejs.go}`; create `tests/conformance/{compose.yaml,unit.dockerfile,integration.dockerfile,main.go}` and `tests/conformance/cases/roots.go`.

**Interfaces:** Produce `InvocationSpec{Version, ExecutionID, InvocationDigest, Language, EnvironmentDigest, ProfileDigest string; Budget Budget; Network network.NetworkScope}`. `Budget` has positive `InputBytes, CodeBytes, StdoutBytes, StderrBytes, DiskBytes, MemoryBytes, PIDs, FDs, Concurrent, QueueDepth int64`, `CPUQuotaMicros, CPUPeriodMicros, CPUTimeMillis, WallMillis, QueueMillis, CleanupMillis int64`. CS1 defines the network DTO described in CS4 and initially accepts its `mode=none` representation only; CS4 implements scoped networking. Produce `Supervisor.Start(context.Context, InvocationSpec, io.Reader) (*Execution, error)` and `Execution.Wait(context.Context) (ExecutionResult, error)`; CS2 extends cancellation/cleanup. `ExecutionResult` includes `ExecutionID`, `InvocationDigest`, `Status`, bounded stdout/stderr, exit code and measured usage.

- [ ] **RED — add strict decoding and actual isolation controls.** Versioned request options reject unknown fields, zero/negative/overflowing budgets, language/profile mismatch and nonmatching invocation digests before UID allocation. Keep the existing unversioned API behavior on the ordinary service. Add this table test:

```go
func TestRejectsInvalidBudget(t *testing.T) {
    b := validTestBudget()
    b.MemoryBytes = 0
    if err := b.Validate(); err == nil { t.Fatal("zero memory admitted") }
    b = validTestBudget()
    b.QueueMillis = -1
    if err := b.Validate(); err == nil { t.Fatal("negative queue admitted") }
}
```

`validTestBudget() Budget` is a test helper supplying finite nonzero synthetic limits; it is never the production profile. Define `Profile.Validate() error`, `Budget.Validate() error` and the helper in the named test file.

- [ ] **RED — run in Linux Docker.** `docker compose -f tests/conformance/compose.yaml run --rm unit go test ./internal/core/runner/isolation -run 'TestRejectsInvalidBudget|TestIndependentRoots' -count=1` must fail against missing supervisor/validation. `unit` builds from the pinned Linux test toolchain; it has no production credentials or Docker socket.
- [ ] **GREEN — implement the supervisor boundary.** A child worker enters its own mount/PID/IPC/UTS/network namespaces, mounts the qualified environment read-only, receives a private bounded writable root/tmpfs, and uses an explicit cwd. Parent places it in a delegated cgroup v2 before releasing a pipe gate that permits user code to start; apply memory/CPU/PID controls and FD/file-size/CPU-time rlimits there. Close unrelated FDs and give no host `/proc`, devices, service sockets or business mounts. Existing Python/Node bootstrap and seccomp still execute the submitted program; this worker is an isolation wrapper, not a replacement language executor.

```go
cmd.Dir = execution.WorkDir
cmd.Env = execution.ChildEnv()
if err := execution.AttachCgroup(cmd.Process.Pid); err != nil {
    return execution.FailBeforeStart(err)
}
return execution.ReleaseStartGate()
```

Define these methods on `Execution`; `AttachCgroup` runs after starting the gated worker and before the child can process code. Namespace/cgroup/mount setup failure refuses before user code; do not weaken the profile when the host lacks support.

- [ ] **GREEN — remove global mutations and bound admission.** Replace `os.Chdir` in `temp_dir.go` with explicit command directories/absolute paths; keep bootstrap files inside the request root. Register execution ID/digest atomically; duplicate IDs return the existing owned execution or digest conflict, never another process. Bound body/code bytes before decoding/allocating and implement cancel-aware finite queue/concurrency admission rather than an unbounded channel wait.
- [ ] **GREEN — validate server authority for all limits.** Compute effective request limits from the immutable server profile and the common owner's remaining reservation; reject attempts to exceed either. Enforce independent service-wide queue/concurrency ceilings so many individually valid requests cannot bypass aggregate capacity. Reserve queued request memory, and release reservations exactly once after clean termination or quarantine accounting.
- [ ] **GREEN — expose the test harness without a competing executor.** `tests/conformance/main.go` accepts `--case roots-and-budgets`, provisions synthetic requests through the actual HTTP controller and reads independent supervisor observations. `integration.dockerfile` packages only this harness; `compose.yaml` supplies separate candidate-service and canary containers. Harness failures return nonzero and required case names are enumerated, not discovered by a success-prone empty glob.
- [ ] **VERIFY — rerun the command above, then `docker compose -f tests/conformance/compose.yaml run --rm integration --case roots-and-budgets`.** The latter service/harness observes separate roots/PID namespaces, CPU/memory/PID/FD/disk limits and mixed-language parallel cwd stability. It requires a disposable Linux runner with delegated cgroups and scoped namespace capabilities; unavailable features are failures, not skips. Assert a peer request survives each exceeded limit.
- [ ] **COMMIT in sandbox:** `git add internal/core/runner internal/controller internal/service cmd/request-worker tests/conformance` then `git commit -m "feat(sandbox): isolate bounded request executions"`.

## Task CS2: Bounded I/O, process-tree cancellation and quarantine

**Depends on:** CS1. Independently rejects unbounded collector growth and unsafe resource reuse.

**Files:** Modify `internal/core/runner/output_capture.go`, `internal/service/{python,nodejs}.go`, `internal/core/runner/isolation/{supervisor,registry,linux}.go`, `internal/core/runner/{python/python.go,nodejs/nodejs.go,uidpool/uid_pool.go}`, `internal/controller/{run,router}.go`; create `internal/core/runner/isolation/{capture,cleanup,capture_test,cleanup_test}.go`, `tests/conformance/cases/lifecycle.go`.

**Interfaces:** Produce `Capture(ctx context.Context, stdout, stderr io.Reader, budget Budget) CaptureResult`; `CaptureResult{Stdout, Stderr []byte; Failure string}`. Add `Execution.Cancel(ctx context.Context, reason string) (ExecutionResult, error)`, `Supervisor.Lookup(executionID, invocationDigest string) (*Execution, error)`, and states `queued/running/terminating/terminal/quarantined`. `POST /v1/sandbox/executions/:id/cancel` requires the authenticated server caller and matching invocation digest; it is idempotent. `GET /v1/sandbox/executions/:id` returns bounded status/cleanup evidence, never code or environment values.

- [ ] **RED — pin byte-exact failure and cancellation behavior.** Add this collector test and actual-image cases for stderr-only flooding, UTF-8 boundaries, endless output, descendants holding pipes and a child ignoring TERM:

```go
func TestOutputLimitIsFailure(t *testing.T) {
    b := validTestBudget()
    b.StdoutBytes = 4
    r := Capture(context.Background(), strings.NewReader("abcdef"), strings.NewReader(""), b)
    if r.Failure != "stdout_limit" || len(r.Stdout) > 4 {
        t.Fatalf("unbounded or successful capture: %#v", r)
    }
}
```

- [ ] **RED — run:** `docker compose -f tests/conformance/compose.yaml run --rm unit go test ./internal/core/runner/isolation -run 'TestOutputLimitIsFailure|TestCleanupQuarantine' -count=1`; expect missing bounded capture/quarantine assertions to fail.
- [ ] **GREEN — replace both unbounded strings.Builder collectors.** Enforce independent stdout/stderr byte ceilings before append and bounded combined response serialization. On output limit, timeout or truncation, stop dispatching output and terminate the execution; preserve an explicit failing result. A malformed result marker, incomplete UTF-8 or truncated JSON must never be interpreted as valid native output.

```go
if n > remaining {
    result.Failure = "stdout_limit"
    execution.RequestTermination("stdout_limit")
    break
}
```

`Execution.RequestTermination(reason string)` performs an idempotent state transition observed by the supervisor. The capture goroutines must unblock on termination; a blocked sink cannot prevent the timer/cancel path from killing the process tree.

- [ ] **GREEN — complete process-tree lifetime.** Use request context cancellation and the explicit cancel endpoint; signal the request process group, enforce finite grace, kill the request cgroup, reap PID-namespace descendants and confirm `cgroup.events` is empty. Bound pipe-drain and wait separately. Cleanup root/mount/UID/FD state before capacity is released. Persist a nonsecret supervisor journal of owned execution resources so restart reconciliation can reap/quarantine orphans before accepting new work; unknown external outcome never causes script replay.
- [ ] **GREEN — distinguish losing a response from losing execution.** Dify may query the same execution ID after a transport disconnect. An owned terminal result may be retrieved with its digest; a dispatched execution with missing state returns unknown. A second POST with the same ID must not create another worker, and a different digest returns conflict.

```go
existing, err := registry.Find(spec.ExecutionID)
if err == nil && existing.InvocationDigest != spec.InvocationDigest {
    return nil, ErrInvocationConflict
}
```

Define `Registry.Find(executionID string) (*Execution, error)` and `ErrInvocationConflict` in `registry.go`; use the registry's locked insert-or-find for creation, rather than treating this illustrative lookup as an atomic claim.
- [ ] **GREEN — quarantine failed cleanup.** A failed unmount/reap/delete or unreconciled worker death marks its slot/root/UID quarantined, never returned to the pool. Continue healthy slots within the advertised capacity; if none remain return explicit unavailable. Reconciliation verifies absence of processes/mounts/files before restoring capacity. Journal records use atomic replace/fsync and service-only storage outside child mounts.
- [ ] **VERIFY:** rerun unit RED command and `docker compose -f tests/conformance/compose.yaml run --rm integration --case lifecycle`. Include request disconnect before/after dispatch, cancel races, supervisor restart, duplicate cancel, wrong digest, forced cleanup failure and successful subsequent peer execution; independently count surviving processes, FDs and UID reuse.
- [ ] **COMMIT in sandbox:** `git add internal/core/runner internal/service internal/controller tests/conformance` then `git commit -m "fix(sandbox): bound output and reap cancelled request trees"`.

## Task CS3: Frozen useful Python, Node and Jinja environments

**Depends on:** CS1; CS2 cleanup applies to dependency workloads. This task produces immutable environments without changing the ordinary endpoint's dependency-update behavior.

**Files:** Create `internal/core/runner/environment/{manifest,verify,manifest_test}.go`, `dependencies/builder/{python.lock,node-package.json,node-package-lock.json}`, `docker/templates/builder.dockerfile`, `scripts/build-builder-environment.sh`, `tests/conformance/cases/dependencies.go`; modify `internal/server/server.go`, `internal/core/runner/python/{env,setup}.go`, `internal/core/runner/nodejs/setup.go`, `build/{build_amd64,build_arm64}.sh` for explicit Builder-profile initialization.

**Interfaces:** Produce `EnvironmentManifest{SchemaVersion int; Digest, PythonVersion, NodeVersion, JinjaVersion, PythonTreeDigest, NodeTreeDigest, NativeLibraryDigest string}` and `VerifyEnvironment(root string, expected EnvironmentManifest) error`. `Profile.EnvironmentDigest` selects the baked artifact; requests cannot supply paths or package installation commands. Additional packages create another locked environment artifact and release qualification.

- [ ] **RED — test imports and tamper detection.** Pin the currently supported useful Python packages from the production Dockerfile (httpx, requests, Jinja, PySocks and transitive dependencies) to hashes; lock the existing Node dependency tree including koffi. Record interpreter/native-library versions, architecture and licenses. Add actual-image Python requests/httpx/Jinja imports, Node built-in modules and installed koffi loading; compare ordinary outputs for computation, Unicode, arrays/objects and Jinja loops/filters.

```go
func TestManifestDetectsMutation(t *testing.T) {
    root, manifest := writeTestEnvironment(t)
    if err := os.WriteFile(filepath.Join(root, "library"), []byte("changed"), 0600); err != nil { t.Fatal(err) }
    if err := VerifyEnvironment(root, manifest); err == nil { t.Fatal("mutable environment accepted") }
}
```

`writeTestEnvironment(t *testing.T) (string, EnvironmentManifest)` writes synthetic files in `t.TempDir()` and computes the expected manifest; production verification uses the identical canonical digest algorithm.

- [ ] **RED — run:** `docker compose -f tests/conformance/compose.yaml run --rm unit go test ./internal/core/runner/environment -run TestManifestDetectsMutation -count=1`; expect missing verifier failure.
- [ ] **GREEN — bake the environment.** Build dependencies at image build time using hash-locked Python wheels and `npm ci`; include native dependencies needed by the audited interpreter/bootstrap. Mount the resulting tree read-only per request, with private caches/temp locations. The Builder profile skips startup install, update ticker and dependency mutation routes explicitly; do not use an invalid interval value as a hidden disable switch. Ordinary profile retains its existing owner and configuration semantics.

```dockerfile
COPY dependencies/builder/python.lock /build/python.lock
RUN pip3 install --require-hashes --no-cache-dir -r /build/python.lock
COPY dependencies/builder/node-package.json /build/node/package.json
COPY dependencies/builder/node-package-lock.json /build/node/package-lock.json
RUN cd /build/node && npm ci --ignore-scripts
```

If an existing native package requires a build/install script, execute that locked, reviewed script in the build stage and attest its output; do not remove the dependency to make `--ignore-scripts` pass. Neither package managers nor mutable dependency mounts are available to test requests.

- [ ] **VERIFY:** rerun the unit command and `docker compose -f tests/conformance/compose.yaml run --rm integration --case dependencies`. Assert a dependency write/update attempt fails, digest drift stops before code starts, serial/parallel caches do not leak data, and ordinary supported imports still work. No acceptance based only on `x + 1`.
- [ ] **COMMIT in sandbox:** `git add internal/core/runner/environment internal/server internal/core/runner/python internal/core/runner/nodejs/setup.go dependencies/builder docker/templates/builder.dockerfile scripts build tests/conformance` then `git commit -m "feat(sandbox): freeze useful builder execution environments"`.

## Task CS4: Enforce default-deny and explicitly scoped live networking

**Depends on:** CS1–CS3; consumes shared authorization scope, never client/model approval flags.

**Files:** Extend `internal/core/runner/network/scope.go`; create `internal/core/runner/network/{linux,gateway,scope_test}.go`, `cmd/network-gateway/main.go`, `tests/conformance/cases/network.go`; modify `internal/core/runner/isolation/{contracts,profile,linux}.go`, `internal/controller/run.go`, `internal/core/runner/python/python.go`, `internal/core/runner/nodejs/nodejs.go`; create `docs/builder-network-scope.md`.

**Interfaces:** Produce `NetworkScope{Mode string; Destinations []Destination; InputManifestDigest string; MaxEgressBytes int64; ExpiresAt int64; ScopeDigest string}`; `Destination{Protocol, Host string; Port uint16; Addresses []string}`. Modes are `none` and `scoped`; unknown modes fail. Produce `NamespaceHandle{PID, NetNSFD int; ExecutionID string}`, `ValidateScope(NetworkScope) error` and `ApplyScope(ctx context.Context, handle NamespaceHandle, scope NetworkScope) (NetworkReceipt, error)`. This avoids a network→isolation package cycle. The server-authenticated invocation envelope binds scope digest, environment, code/input digests, remaining budget and expiry; it contains no grant-minting authority.

- [ ] **RED — prove the harness before denial.** A synthetic canary must observe TCP/UDP/DNS/HTTP/HTTPS and IPv4/IPv6 on a deliberately permissive test control. The same targets must observe zero traffic from `mode=none`. Add scope tests for missing data manifest, expired scope, wildcard targets, address/port/protocol changes and mismatched digests; broad scope requires an explicitly bounded representation, not a wildcard escape.

```go
func TestScopedNetworkRequiresDataBinding(t *testing.T) {
    s := validNetworkTestScope()
    s.InputManifestDigest = ""
    if err := ValidateScope(s); err == nil { t.Fatal("unbound data scope accepted") }
}
```

`validNetworkTestScope() NetworkScope` returns a nonexpired scope for one synthetic canary address/port with a canonical data-manifest digest; the helper is defined in `scope_test.go`.

- [ ] **RED — run:** `docker compose -f tests/conformance/compose.yaml run --rm unit go test ./internal/core/runner/network -run TestScopedNetworkRequiresDataBinding -count=1`; expect absent validation failure.
- [ ] **GREEN — enforce in the request namespace.** `none` has no reachable business/platform/host network. `scoped` receives only the specified protocol/IP/port routes through a trusted policy gateway; deny all direct alternate routes, host/loopback peers, metadata, control-plane services and unapproved proxies. Gateway resolves/pins approved DNS results, checks every redirect/new destination, enforces byte/deadline quotas and binds rules to the execution identity. Raw TCP/UDP is available only when its bounded destination/protocol mode is qualified; otherwise report missing runtime capability before dispatch. Apply independent seccomp defaults with no arbitrary syscall override or generated preload.

```go
if spec.Network.Mode == "scoped" && !profile.Supports(spec.Network) {
    return ExecutionResult{Status: "configuration_required"}, nil
}
receipt, err := network.ApplyScope(ctx, execution.NetworkHandle(), spec.Network)
if err != nil { return execution.FailBeforeStart(err) }
execution.NetworkReceipt = receipt
```

Define `Profile.Supports(network.NetworkScope) bool`, `Execution.NetworkHandle() network.NamespaceHandle` and `Execution.NetworkReceipt`; receipt records applied policy digest/usage, not packet contents or credentials. The worker may need network syscalls for scoped traffic, but the namespace/gateway remains the enforcing boundary; setting the legacy boolean is never the scope itself.

- [ ] **GREEN — bind the policy gateway lifetime.** `cmd/network-gateway` installs only authenticated supervisor-supplied execution rules, has no business credentials and exposes no rule-management endpoint to child namespaces. Kernel routing/firewall rules pin source identity and approved destinations; gateway counters enforce aggregate byte/deadline scope for TCP/UDP and controlled DNS. HTTP proxy redirects are rechecked; opaque TLS/raw transport is disclosed as destination-bound opaque traffic, never claimed to have per-message semantic inspection. Revocation tears down the scoped routes and active connections.

- [ ] **GREEN — protect data and identity.** Child environment starts empty plus explicit language/runtime values and approved input manifest/SecretRef versions resolved by the trusted Dify owner. API keys/proxy credentials used to control the service remain outside the child. Disclosure covers the full opaque script, accessible input files/data, execution identity, dependency digest, target network and maximum dispatch/bytes/time. Do not claim individual hidden messages were separately approved. Any related mutation requires another common-owner decision before launch.
- [ ] **VERIFY:** rerun unit RED command and `docker compose -f tests/conformance/compose.yaml run --rm integration --case network`. Test approved canary success, new target waiting at Dify admission, DNS rebinding, redirect/proxy/IPv6 bypass, simultaneous different scopes, quota exhaustion, expiry/revocation and retained no-network behavior. Controlled canaries use synthetic payloads only.
- [ ] **COMMIT in sandbox:** `git add internal/core/runner/network internal/core/runner/isolation internal/controller/run.go internal/core/runner/python/python.go internal/core/runner/nodejs/nodejs.go tests/conformance docs/builder-network-scope.md` then `git commit -m "feat(sandbox): enforce invocation network and data scope"`.

## Task CS5: Actual-image conformance, measured profiles and release contract

**Depends on:** CS1–CS4. Produces a release-level qualification consumed by CS6; Agent backend qualification remains separately required.

**Files:** Create `.github/workflows/builder-conformance.yml`, `scripts/{builder-conformance.sh,verify-builder-release.py}`, `tests/conformance/{manifest.schema.json,budget.schema.json,verifier.dockerfile,test_release_manifest.py}`, `tests/conformance/cases/{qualification,budgets}.go`, `docs/builder-release-contract.md`; extend `tests/conformance/{main.go,compose.yaml}` and existing `.github/workflows/{tests,build}.yml` only through normal reviewed build/release ownership.

**Interfaces:** Produce immutable `SandboxQualificationV1`: schema/profile version, sandbox source/build provenance, image index/platform/config digests, architecture/kernel/runtime/seccomp/cgroup identity, environment digest, effective configuration/mount/network/resource digests, measured budget values, language/case results, CI run/test revision, issue/expiry/revocation identifiers. Produce `EndpointCapabilityReceipt{endpoint_identity, qualification_digest, deployment_generation, effective_profile_digest, expires_at}` from the trusted deployment/controller owner. The sandbox self-reported digest is corroboration, not proof of which endpoint is running.

- [ ] **RED — reject incomplete qualification.** Add manifest verifier tests for missing case, skipped/xfail result, wrong architecture, stale environment, unsigned provenance, expired/revoked record, changed effective configuration and endpoint receipt mismatch:

```python
def test_qualification_rejects_wrong_environment(valid_release):
    valid_release["runtime"]["environment_digest"] = "sha256:" + "0" * 64
    with pytest.raises(ValueError, match="environment"):
        verify_release(valid_release)
```

`verify_release(document: dict) -> dict` lives in `scripts/verify-builder-release.py`; `valid_release` is a synthetic immutable-schema fixture in `tests/conformance/test_release_manifest.py`. No service key, arbitrary environment dump, source code or low-entropy secret hash belongs in public qualification.

- [ ] **RED — run:** `docker compose -f tests/conformance/compose.yaml run --rm verifier python -m pytest tests/conformance/test_release_manifest.py -q`; expect missing verifier or mismatch acceptance failure.
- [ ] **GREEN — run the built artifact, not a test substitute.** CI builds/pins amd64 and arm64 candidates with normal build provenance, then runs the published candidate digest in disposable Linux fixtures. Keep build/push credentials in the build job only; execution containers receive no CI/cloud credentials or Docker socket. CI runner provisions supervisor namespace/cgroup permissions outside user execution, verifies them and refuses unsupported hosts instead of skipping cases. Canary/supervisor independently records zero-hit denial, process death, isolation, resource usage and cleanup.
- [ ] **GREEN — measure and freeze finite profiles.** `scripts/builder-conformance.sh --measure --output artifacts/budget-candidate.json` runs serial and four-way mixed Python/Node dependency workloads plus Jinja, records peak CPU/memory/PID/FD/disk/output and completion distributions. Select finite limits covering these useful loads with documented headroom; rerun all limit-exceed/recovery controls using the selected profile and commit its numeric budget artifact. The release verifier refuses missing/nonpositive values, missing measurements or a normal workload exceeding its profile. Historical candidates are not a pass criterion.
- [ ] **GREEN — authenticate and bind evidence.** `scripts/builder-conformance.sh --verify --output artifacts/qualification.json` requires every CS1–CS4 case, serial/concurrent cross-tenant reuse, worker crash/restart, dependency drift and ordinary-endpoint controls. The release job signs/attests canonical qualification after passing; trusted deployment verifies actual immutable mounts/image/routing/config before issuing the endpoint receipt. Drift/redeploy/expiry revokes capability. No per-plugin/node qualification queue is introduced.
- [ ] **GREEN — pin the actual case inventory.** Include `roots-and-budgets`, `lifecycle`, `dependencies`, `network`, `qualification` and `ordinary-regression`; `--case all` must require all six nonempty groups. Export unique per-language/per-platform case IDs and fail if actual IDs differ from the manifest inventory.

```python
assert set(report["case_ids"]) == set(manifest["required_case_ids"])
assert report["skipped"] == 0
assert report["failed"] == 0
```

The release verifier implements these assertions as explicit errors with case IDs. Reports contain observed test failures, rather than a bare operator-provided `verified=true` field.
- [ ] **VERIFY:** rerun verifier RED command, then `docker compose -f tests/conformance/compose.yaml run --rm integration --case all`. CI must retain exact case inventory, JUnit results, measurement artifact and bounded canary/supervisor receipts; missing/skipped cases fail. Ordinary API requests still run against their separate unchanged endpoint, including controlled ordinary network=true behavior.
- [ ] **COMMIT in sandbox:** `git add .github/workflows scripts tests/conformance docs/builder-release-contract.md` then `git commit -m "test(sandbox): qualify actual builder execution artifacts"`. Publishing an image or deploying it follows the root's normal release sequence after review; a commit alone does not activate Dify capability.

## Task CS6: Dify per-invocation native Code/Jinja adapter and CI composition

**Depends on:** common root contracts/authorization/lifecycle/encrypted state owner; CS5 qualification; native lane's control bridge and final factory composition. Transport unit work may proceed using synthetic receipts; activation waits for all dependencies.

**Files:** Create `api/services/code_execution/{__init__,contracts,transport}.py`, `api/services/dify_builder/native_testing/sandbox/{__init__,contracts,qualification,executor}.py`; modify only thin `api/core/helper/code_executor/code_executor.py`, `api/core/workflow/template_rendering.py` and existing `api/configs/feature/__init__.py`. Create `api/tests/unit_tests/services/dify_builder/native_testing/test_sandbox_executor.py`, `api/tests/unit_tests/services/code_execution/test_transport.py`, `api/tests/test_containers_integration_tests/core/workflow/test_builder_native_sandbox.py`; extend existing CodeExecutor unit tests and `.github/workflows/builder-safe-execution-tests.yml` through the single CI owner after handoff. **Do not edit `node_factory.py` in this lane.**

**Interfaces:** `CodeExecutionTransport.execute(*, language: str, preload: str, code: str) -> str` owns HTTP serialization. `CodeExecutor.execute_code` and `execute_workflow_code_template` accept keyword-only `transport: CodeExecutionTransport | None = None`; None selects the ordinary transport with its existing endpoint and true default. Produce frozen `SandboxInvocation(ref, key, environment_digest, profile_digest, input_manifest_digest, network_scope, budget_reservation_ref, capability_receipt)` and `SandboxWorkflowCodeExecutor.execute(*, language, code, inputs) -> Mapping[str, Any]`, `is_execution_error(error: Exception) -> bool`, compatible with installed `CodeExecutorProtocol`. `CodeExecutorJinja2TemplateRenderer(*, code_executor: CodeExecutorProtocol | None = None)` delegates to that collaborator. `SandboxQualificationProvider.resolve(*, endpoint_identity, language, environment_digest) -> EndpointCapabilityReceipt` verifies the trusted current deployment evidence. `BoundSandboxTransport(invocation: SandboxInvocation)` implements `CodeExecutionTransport`; it owns the shared authorization/state/control services injected by construction and calls the same HTTP transport implementation as ordinary execution.

- [ ] **RED — pin ordinary/policy separation and exact transformation.** Add ordinary=True/default-endpoint and Builder=no-direct-network tests for both helper entry points, Python/JS and Jinja, concurrent calls and missing context. ApprovalWait/PolicyStop must return to the native control bridge before RPC; RecordedResult loads the actual encrypted execution result without dispatch; receipt failure blocks dispatch. Define `run_code_case(language, policy, code, inputs)` as the test harness invoking the actual transformer with a recording HTTP transport and common-owner fixture.

```python
def test_wait_does_not_dispatch(sandbox_executor, authorization, http_transport):
    authorization.wait_for_approval()
    with pytest.raises(NativeApprovalWait) as raised:
        sandbox_executor.execute(language=CodeLanguage.PYTHON3, code="def main(x): return {'y': x + 1}", inputs={"x": 41})
    assert raised.value.disposition == "pause"
    assert http_transport.calls == []
```

The native lane's NW3 publishes `control.NativeApprovalWait` and `control.NativePolicyStop` as typed Graphon `NodeExecutionControl` subtypes. `NativeControlBridge.resolve` raises them with `pause` or `stop`; they must be captured before Code/default-output/retry conversion. The common lane owns durable checkpoint/control translation, not this sandbox module.

- [ ] **RED — run in normal Linux CI:** `uv run --project api --no-sync pytest api/tests/unit_tests/services/dify_builder/native_testing/test_sandbox_executor.py api/tests/unit_tests/services/code_execution/test_transport.py api/tests/unit_tests/core/helper/code_executor/test_code_executor.py -q`; expect missing collaborators and missing request options, never claim transport mocks prove isolation.
- [ ] **GREEN — extract one transport and retain native semantics.** Move existing HTTP request/response handling to the shared service transport; ordinary adapters keep current pooled client/timeout/TLS/key ownership. Builder transport uses immutable endpoint/profile/options per instance, prechecks code/input limits, verifies qualification before each dispatch, sends versioned invocation/cancel identity, and parses explicit sandbox failures before transformer parsing. Bound HTTP response bytes while streaming; a cap does not replace sandbox-side limits. Jinja continues through the existing Python Jinja transformer, not the old limited AST interpreter for new policy requests.

```python
decision = authorization.before_call(ref=invocation.ref, intent=intent)
permit = control.resolve(ref=invocation.ref, decision=decision)
if isinstance(permit, RecordedResult):
    return execution_state.load_result(ref=invocation.ref, result_ref=permit.result_ref)
result = transport.execute(language=running_language, preload="", code=runner)
result_ref = execution_state.store_result(ref=invocation.ref, key=invocation.key, result=result)
authorization.record_outcome(permit=permit, outcome="completed", result_ref=result_ref)
```

`control` is `NativeControlBridge` and `execution_state` implements the root-owned `NativeStatePort`; encrypted durable storage is required before recording a reusable result. C01 includes `EffectIntent.kind='code'` for Python/JS/Jinja, with language/runtime identified by `resource_ref`; build the intent from the full code/inputs/environment/scope digests and real operation key. For the qualified profile, trusted Jinja preload is represented in the environment artifact; generated preload is refused. Ledger outcomes use exactly `completed/failed/unknown/not_dispatched`; detailed sandbox cancelled/limit/cleanup status lives in the stored execution result. Never replay an unknown execution. Connect shared cancellation to the supervisor cancel endpoint and verify terminal cleanup without claiming cancellation retracts already sent network effects.

Preserve C01 `ApprovalWait.wait_reason`. Missing runtime qualification, dependencies or enforceable network scope creates a durable `configuration` pending action through C02's `NativePendingActionService.configuration` before requesting a dispatch permit; feed it through the same control bridge. User approval cannot satisfy absent runtime configuration. If the server reports configuration drift after RPC, record the actual known-unstarted/unknown execution state and wait for configuration, never send it to Code Fix as a business-code error. Tests cover qualification missing before permit, drift before user code starts, and no automatic reexecution after an uncertain result.

- [ ] **GREEN — hand off final native composition.** Root native lane injects `SandboxWorkflowCodeExecutor` and the configured Jinja renderer by `builder-native-test-v1` context, preserving all old v1 adapters. It supplies actual node/iteration/child occurrence keys, budget reservations and the control bridge. Add fail-closed tests for missing invocation, stale endpoint/environment/profile, unsupported language, revoked capability, mutated input/code/network scope and parallel context isolation.
- [ ] **VERIFY — actual native CI:** `uv run --project api --no-sync pytest api/tests/test_containers_integration_tests/core/workflow/test_builder_native_sandbox.py --start-middleware -q`. The normal Linux CI job provisions the qualified digest and test DB/Redis/storage; cases execute real native CodeNode/TemplateTransformNode through port→worker→GraphEngine and persisted Run/node rows. Assert Python/JS return 42, useful installed imports work, native Jinja loops/filters render expected text, invalid native output schema fails, limits/cancel fail truthfully, approval/resume dispatches once and two parallel languages retain distinct scopes. Preserve ordinary Code/Jinja and old Template/JSON/Gmail CI gates; no host integration run.
- [ ] **COMMIT in Dify:** stage the exact CS6 service/core/config/test files above, then `git commit -m "feat(builder): run native code with scoped sandbox invocations"`. CI workflow/factory changes belong their root owners' commits; record their dependency SHAs rather than staging concurrent edits.

## Completion and handoff gates

- CS1–CS5 sandbox commits and released image/provenance are separate from CS6 Dify commits. Record both source SHAs, exact platform image/environment/profile digests and qualification/endpoint receipt references.
- CS6 transport tests do not qualify an image; CS5 image tests do not prove native factory/control wiring. Require both, plus root native-lane composed persistence/control tests, before enabling the profile.
- Shared/native owners implement the concrete control bridge and encrypted result-store contracts recorded above before CS6 integration. No fallback to ordinary execution while integration is incomplete.
- ENG-1189 completes only with useful dependency workloads, actual isolation/limits/cancel/cleanup, scoped live canaries, ordinary regressions and native Code/Jinja evidence. Unavailable Linux isolation primitives, failed dependency compatibility or missing trusted endpoint binding remain specific blockers.
- Root's combined acceptance additionally requires `Start → Code → Iteration(New Agent) → Tool → End`, Agent-specific environment conformance and dynamic approval/resume. This lane cannot close those requirements with CodeSandbox evidence.
- Independent review, normal CI/release, authorized Local E2E, normal Helm Dev deployment and Dev E2E follow the root plan. No production/business account call is authorized by engineering approval; each real call uses its prepared confirmed scope.
- Self-review completed for ownership, six independently testable tasks, every Review Focus case, shared contract names, Linux-only commands, separate repository commits and preserved ordinary/legacy behavior. This plan reports no newly passed execution tests.
