from __future__ import annotations

import asyncio
from dataclasses import dataclass, field
from typing import cast

import pytest
from shellctl.shared import HealthResponse

from dify_agent.adapters.shell.protocols import ShellCommandProtocol
from dify_agent.adapters.shell.shellctl import ShellctlClientProtocol
from dify_agent.runtime_backend import (
    BindingAcquireError,
    BindingCreateError,
    BindingDestroyError,
    ExecutionBindingAllocation,
    ExecutionBindingCreateSpec,
    ExecutionBindingDestroySpec,
    HomeSnapshotCreateSpec,
    RuntimeLayout,
    RuntimeLease,
)
from dify_agent.runtime_backend.local_rollout import (
    LocalRuntimeRouter,
    LocalRuntimeTarget,
    RoutedLocalExecutionBindingBackend,
    RoutedLocalHomeSnapshotBackend,
    RoutedLocalRuntimeLease,
    ShellctlHealthProbe,
    _is_rust_canary,  # pyright: ignore[reportPrivateUsage]
)


@dataclass(slots=True)
class _Lease:
    owner: str
    layout: RuntimeLayout = field(default_factory=lambda: RuntimeLayout(home_dir="/home", workspace_dir="/workspace"))
    commands: ShellCommandProtocol = field(default_factory=lambda: cast(ShellCommandProtocol, object()))


@dataclass(slots=True)
class _BindingBackend:
    owner: str
    create_error: Exception | None = None
    creates: list[ExecutionBindingCreateSpec] = field(default_factory=list)
    acquires: list[str] = field(default_factory=list)
    releases: list[RuntimeLease] = field(default_factory=list)
    destroys: list[ExecutionBindingDestroySpec] = field(default_factory=list)

    async def create_binding(self, spec: ExecutionBindingCreateSpec) -> ExecutionBindingAllocation:
        self.creates.append(spec)
        if self.create_error is not None:
            raise self.create_error
        return ExecutionBindingAllocation(
            binding_ref=f"{spec.binding_id}:{spec.workspace_id}",
            workspace_ref=spec.workspace_id,
        )

    async def acquire(self, binding_ref: str) -> RuntimeLease:
        self.acquires.append(binding_ref)
        return _Lease(owner=self.owner)

    async def release(self, lease: RuntimeLease) -> None:
        self.releases.append(lease)

    async def destroy_binding(self, spec: ExecutionBindingDestroySpec) -> None:
        self.destroys.append(spec)


@dataclass(slots=True)
class _HomeBackend:
    owner: str
    creates: list[tuple[HomeSnapshotCreateSpec, RuntimeLease]] = field(default_factory=list)
    deletes: list[str] = field(default_factory=list)

    async def create_from_runtime(self, *, spec: HomeSnapshotCreateSpec, source: RuntimeLease) -> str:
        self.creates.append((spec, source))
        return f"home-{spec.home_snapshot_id}"

    async def delete(self, snapshot_ref: str) -> None:
        self.deletes.append(snapshot_ref)


@dataclass(slots=True)
class _Probe:
    error: Exception | None = None
    calls: int = 0

    async def __call__(self) -> None:
        self.calls += 1
        if self.error is not None:
            raise self.error


@dataclass(slots=True)
class _HealthClient:
    status: str = "ok"
    error: Exception | None = None
    wait_forever: bool = False
    close_error: Exception | None = None
    closed: bool = False

    async def health(self) -> HealthResponse:
        if self.wait_forever:
            _ = await asyncio.Event().wait()
        if self.error is not None:
            raise self.error
        return HealthResponse(status=self.status)

    async def close(self) -> None:
        self.closed = True
        if self.close_error is not None:
            raise self.close_error


@dataclass(slots=True)
class _Fixture:
    router: LocalRuntimeRouter
    go_bindings: _BindingBackend
    rust_bindings: _BindingBackend
    go_snapshots: _HomeBackend
    rust_snapshots: _HomeBackend
    probe: _Probe


def _fixture(*, canary_percent: int, probe_error: Exception | None = None) -> _Fixture:
    go_bindings = _BindingBackend(owner="go")
    rust_bindings = _BindingBackend(owner="rust")
    go_snapshots = _HomeBackend(owner="go")
    rust_snapshots = _HomeBackend(owner="rust")
    probe = _Probe(error=probe_error)
    router = LocalRuntimeRouter(
        go=LocalRuntimeTarget(
            implementation="go",
            home_snapshots=go_snapshots,
            execution_bindings=go_bindings,
        ),
        rust=LocalRuntimeTarget(
            implementation="rust",
            home_snapshots=rust_snapshots,
            execution_bindings=rust_bindings,
        ),
        rust_canary_percent=canary_percent,
        rust_health_probe=probe,
    )
    return _Fixture(
        router=router,
        go_bindings=go_bindings,
        rust_bindings=rust_bindings,
        go_snapshots=go_snapshots,
        rust_snapshots=rust_snapshots,
        probe=probe,
    )


def _spec(
    *,
    binding_id: str = "binding-1",
    workspace_id: str = "workspace-1",
    existing_workspace_ref: str | None = None,
    home_snapshot_ref: str | None = None,
) -> ExecutionBindingCreateSpec:
    return ExecutionBindingCreateSpec(
        tenant_id="tenant-1",
        agent_id="agent-1",
        binding_id=binding_id,
        workspace_id=workspace_id,
        existing_workspace_ref=existing_workspace_ref,
        home_snapshot_ref=home_snapshot_ref,
    )


def _health_probe(client: _HealthClient, *, timeout_seconds: float = 1.0) -> ShellctlHealthProbe:
    def factory() -> ShellctlClientProtocol:
        return cast(ShellctlClientProtocol, cast(object, client))

    return ShellctlHealthProbe(client_factory=factory, timeout_seconds=timeout_seconds)


@pytest.mark.anyio
async def test_health_probe_closes_client_after_success() -> None:
    client = _HealthClient()

    await _health_probe(client)()

    assert client.closed is True


@pytest.mark.anyio
async def test_health_probe_closes_client_after_unhealthy_status() -> None:
    client = _HealthClient(status="degraded")

    with pytest.raises(RuntimeError, match="unexpected shellctl health status"):
        await _health_probe(client)()

    assert client.closed is True


@pytest.mark.anyio
async def test_health_probe_is_bounded_and_closes_timed_out_client() -> None:
    client = _HealthClient(wait_forever=True)

    with pytest.raises(TimeoutError):
        await _health_probe(client, timeout_seconds=0.001)()

    assert client.closed is True


@pytest.mark.anyio
async def test_health_probe_preserves_probe_error_when_close_also_fails() -> None:
    client = _HealthClient(
        error=ConnectionError("health failed"),
        close_error=RuntimeError("close failed"),
    )

    with pytest.raises(ConnectionError, match="health failed"):
        await _health_probe(client)()

    assert client.closed is True


@pytest.mark.anyio
async def test_health_probe_surfaces_close_error_after_success() -> None:
    client = _HealthClient(close_error=RuntimeError("close failed"))

    with pytest.raises(RuntimeError, match="close failed"):
        await _health_probe(client)()

    assert client.closed is True


def test_canary_hash_is_deterministic_and_tracks_requested_percentage() -> None:
    specs = [_spec(binding_id=f"binding-{index}", workspace_id=f"workspace-{index}") for index in range(1_000)]

    first_pass = [_is_rust_canary(spec, 25) for spec in specs]
    second_pass = [_is_rust_canary(spec, 25) for spec in specs]

    assert first_pass == second_pass
    assert 200 <= sum(first_pass) <= 300
    assert not any(_is_rust_canary(spec, 0) for spec in specs)
    assert all(_is_rust_canary(spec, 100) for spec in specs)


@pytest.mark.parametrize("percent", [-1, 101])
def test_router_rejects_canary_percentage_outside_closed_interval(percent: int) -> None:
    with pytest.raises(ValueError, match="between 0 and 100"):
        _ = _fixture(canary_percent=percent)


@pytest.mark.anyio
async def test_healthy_rust_canary_is_sticky_across_binding_and_snapshot_lifecycle() -> None:
    fixture = _fixture(canary_percent=100)
    bindings = RoutedLocalExecutionBindingBackend(router=fixture.router)
    snapshots = RoutedLocalHomeSnapshotBackend(router=fixture.router)

    allocation = await bindings.create_binding(_spec())

    assert allocation.binding_ref == "rust+binding-1:workspace-1"
    assert allocation.workspace_ref == "rust+workspace-1"
    assert fixture.probe.calls == 1
    assert len(fixture.rust_bindings.creates) == 1
    assert fixture.go_bindings.creates == []

    lease = await bindings.acquire(allocation.binding_ref)
    assert isinstance(lease, RoutedLocalRuntimeLease)
    assert lease.implementation == "rust"
    assert fixture.rust_bindings.acquires == ["binding-1:workspace-1"]

    snapshot_ref = await snapshots.create_from_runtime(
        spec=HomeSnapshotCreateSpec(tenant_id="tenant-1", agent_id="agent-1", home_snapshot_id="snapshot-1"),
        source=lease,
    )
    assert snapshot_ref == "rust+home-snapshot-1"
    await snapshots.delete(snapshot_ref)
    assert fixture.rust_snapshots.deletes == ["home-snapshot-1"]

    await bindings.release(lease)
    assert len(fixture.rust_bindings.releases) == 1
    assert fixture.go_bindings.releases == []


@pytest.mark.anyio
async def test_unhealthy_rust_preflight_assigns_new_binding_to_go() -> None:
    fixture = _fixture(canary_percent=100, probe_error=TimeoutError("rust unavailable"))
    bindings = RoutedLocalExecutionBindingBackend(router=fixture.router)

    allocation = await bindings.create_binding(_spec())

    assert allocation.binding_ref == "binding-1:workspace-1"
    assert allocation.workspace_ref == "workspace-1"
    assert len(fixture.go_bindings.creates) == 1
    assert fixture.rust_bindings.creates == []


@pytest.mark.anyio
async def test_zero_percent_canary_keeps_go_refs_compatible_with_go_only_rollback() -> None:
    fixture = _fixture(canary_percent=0, probe_error=ConnectionError("must not be called"))
    bindings = RoutedLocalExecutionBindingBackend(router=fixture.router)

    allocation = await bindings.create_binding(_spec())

    assert allocation.binding_ref == "binding-1:workspace-1"
    assert allocation.workspace_ref == "workspace-1"
    assert fixture.probe.calls == 0
    assert fixture.go_bindings.acquires == []
    _ = await fixture.go_bindings.acquire(allocation.binding_ref)
    assert fixture.go_bindings.acquires == ["binding-1:workspace-1"]


@pytest.mark.anyio
async def test_existing_go_workspace_bypasses_rust_even_at_full_canary() -> None:
    fixture = _fixture(canary_percent=100, probe_error=ConnectionError("must not be called"))
    bindings = RoutedLocalExecutionBindingBackend(router=fixture.router)

    allocation = await bindings.create_binding(_spec(existing_workspace_ref="workspace-1"))

    assert allocation.binding_ref == "binding-1:workspace-1"
    assert fixture.probe.calls == 0
    assert len(fixture.go_bindings.creates) == 1
    assert fixture.rust_bindings.creates == []


@pytest.mark.anyio
async def test_existing_rust_workspace_stays_rust_when_new_canary_admission_is_disabled() -> None:
    fixture = _fixture(canary_percent=0)
    bindings = RoutedLocalExecutionBindingBackend(router=fixture.router)

    allocation = await bindings.create_binding(_spec(existing_workspace_ref="rust+workspace-1"))

    assert allocation.binding_ref == "rust+binding-1:workspace-1"
    assert fixture.probe.calls == 1
    assert len(fixture.rust_bindings.creates) == 1
    assert fixture.go_bindings.creates == []


@pytest.mark.anyio
async def test_mutating_rust_failure_is_never_replayed_to_go() -> None:
    fixture = _fixture(canary_percent=100)
    fixture.rust_bindings.create_error = BindingCreateError("Rust may already have mutated state")
    bindings = RoutedLocalExecutionBindingBackend(router=fixture.router)

    with pytest.raises(BindingCreateError, match="already have mutated"):
        _ = await bindings.create_binding(_spec())

    assert len(fixture.rust_bindings.creates) == 1
    assert fixture.go_bindings.creates == []


@pytest.mark.anyio
async def test_mutating_go_failure_is_never_replayed_to_rust() -> None:
    fixture = _fixture(canary_percent=0)
    fixture.go_bindings.create_error = BindingCreateError("Go may already have mutated state")
    bindings = RoutedLocalExecutionBindingBackend(router=fixture.router)

    with pytest.raises(BindingCreateError, match="already have mutated"):
        _ = await bindings.create_binding(_spec())

    assert len(fixture.go_bindings.creates) == 1
    assert fixture.rust_bindings.creates == []


@pytest.mark.anyio
async def test_existing_rust_resource_never_falls_back_to_go() -> None:
    fixture = _fixture(canary_percent=0, probe_error=ConnectionError("rust unavailable"))
    bindings = RoutedLocalExecutionBindingBackend(router=fixture.router)

    with pytest.raises(BindingCreateError, match="refusing unsafe Go replay"):
        _ = await bindings.create_binding(_spec(existing_workspace_ref="rust+workspace-1"))

    assert fixture.go_bindings.creates == []
    assert fixture.rust_bindings.creates == []


@pytest.mark.anyio
async def test_cross_runtime_snapshot_and_workspace_are_rejected_before_mutation() -> None:
    fixture = _fixture(canary_percent=100)
    bindings = RoutedLocalExecutionBindingBackend(router=fixture.router)

    with pytest.raises(BindingCreateError, match="different runtime implementations"):
        _ = await bindings.create_binding(
            _spec(
                existing_workspace_ref="go+workspace-1",
                home_snapshot_ref="rust+home-snapshot-1",
            )
        )

    assert fixture.probe.calls == 0
    assert fixture.go_bindings.creates == []
    assert fixture.rust_bindings.creates == []


@pytest.mark.anyio
async def test_legacy_unprefixed_binding_ref_remains_owned_by_go() -> None:
    fixture = _fixture(canary_percent=100)
    bindings = RoutedLocalExecutionBindingBackend(router=fixture.router)

    lease = await bindings.acquire("binding-legacy:workspace-legacy")

    assert isinstance(lease, RoutedLocalRuntimeLease)
    assert lease.implementation == "go"
    assert fixture.go_bindings.acquires == ["binding-legacy:workspace-legacy"]
    assert fixture.rust_bindings.acquires == []


@pytest.mark.anyio
@pytest.mark.parametrize("binding_ref", ["", "go+", "rust+"])
async def test_acquire_rejects_empty_native_refs(binding_ref: str) -> None:
    fixture = _fixture(canary_percent=100)
    bindings = RoutedLocalExecutionBindingBackend(router=fixture.router)

    with pytest.raises(BindingAcquireError, match="must not be empty|include a native ref"):
        _ = await bindings.acquire(binding_ref)

    assert fixture.go_bindings.acquires == []
    assert fixture.rust_bindings.acquires == []


@pytest.mark.anyio
async def test_explicit_go_prefix_is_decoded_but_never_leaks_to_go_backend() -> None:
    fixture = _fixture(canary_percent=100)
    bindings = RoutedLocalExecutionBindingBackend(router=fixture.router)

    lease = await bindings.acquire("go+binding-1")

    assert isinstance(lease, RoutedLocalRuntimeLease)
    assert lease.implementation == "go"
    assert fixture.go_bindings.acquires == ["binding-1"]


@pytest.mark.anyio
async def test_destroy_dispatches_only_to_ref_owner() -> None:
    fixture = _fixture(canary_percent=100)
    bindings = RoutedLocalExecutionBindingBackend(router=fixture.router)

    await bindings.destroy_binding(
        ExecutionBindingDestroySpec(
            binding_ref="rust+binding-1:workspace-1",
            destroy_workspace=True,
            workspace_ref="rust+workspace-1",
        )
    )

    assert fixture.rust_bindings.destroys == [
        ExecutionBindingDestroySpec(
            binding_ref="binding-1:workspace-1",
            destroy_workspace=True,
            workspace_ref="workspace-1",
        )
    ]
    assert fixture.go_bindings.destroys == []


@pytest.mark.anyio
async def test_destroy_rejects_cross_runtime_refs_before_mutation() -> None:
    fixture = _fixture(canary_percent=100)
    bindings = RoutedLocalExecutionBindingBackend(router=fixture.router)

    with pytest.raises(BindingDestroyError, match="different runtime implementations"):
        await bindings.destroy_binding(
            ExecutionBindingDestroySpec(
                binding_ref="rust+binding-1:workspace-1",
                destroy_workspace=True,
                workspace_ref="workspace-1",
            )
        )

    assert fixture.rust_bindings.destroys == []
    assert fixture.go_bindings.destroys == []


@pytest.mark.anyio
async def test_release_rejects_lease_from_outside_router() -> None:
    fixture = _fixture(canary_percent=100)
    bindings = RoutedLocalExecutionBindingBackend(router=fixture.router)

    with pytest.raises(TypeError, match="only release its own"):
        await bindings.release(_Lease(owner="foreign"))

    assert fixture.rust_bindings.releases == []
    assert fixture.go_bindings.releases == []


@pytest.mark.anyio
async def test_home_snapshot_dispatches_to_go_and_rust_owners() -> None:
    fixture = _fixture(canary_percent=100)
    snapshots = RoutedLocalHomeSnapshotBackend(router=fixture.router)
    spec = HomeSnapshotCreateSpec(tenant_id="tenant-1", agent_id="agent-1", home_snapshot_id="snapshot-1")

    go_ref = await snapshots.create_from_runtime(
        spec=spec,
        source=RoutedLocalRuntimeLease(implementation="go", inner=_Lease(owner="go")),
    )
    rust_ref = await snapshots.create_from_runtime(
        spec=spec,
        source=RoutedLocalRuntimeLease(implementation="rust", inner=_Lease(owner="rust")),
    )

    assert go_ref == "home-snapshot-1"
    assert rust_ref == "rust+home-snapshot-1"
    await snapshots.delete(go_ref)
    await snapshots.delete(rust_ref)
    assert fixture.go_snapshots.deletes == ["home-snapshot-1"]
    assert fixture.rust_snapshots.deletes == ["home-snapshot-1"]


@pytest.mark.anyio
async def test_home_snapshot_rejects_unrouted_lease_and_malformed_ref() -> None:
    fixture = _fixture(canary_percent=100)
    snapshots = RoutedLocalHomeSnapshotBackend(router=fixture.router)
    spec = HomeSnapshotCreateSpec(tenant_id="tenant-1", agent_id="agent-1", home_snapshot_id="snapshot-1")

    with pytest.raises(TypeError, match="requires a routed"):
        _ = await snapshots.create_from_runtime(spec=spec, source=_Lease(owner="foreign"))
    with pytest.raises(ValueError, match="include a native ref"):
        await snapshots.delete("rust+")

    assert fixture.go_snapshots.creates == []
    assert fixture.rust_snapshots.creates == []
    assert fixture.go_snapshots.deletes == []
    assert fixture.rust_snapshots.deletes == []
