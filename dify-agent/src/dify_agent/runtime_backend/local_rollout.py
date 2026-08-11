"""Safe, sticky rollout between the local Go and Rust shell runtimes.

Fallback is deliberately limited to the preflight before a new Binding is
created. Once a backend receives a mutating request, the operation is never
replayed against the other implementation because shell commands are not
generally idempotent.

Rust-owned opaque refs carry an implementation prefix. Go-owned refs keep their
original representation, so enabling the router does not migrate Go data and a
Go-only rollback can still read every Go allocation. Existing unprefixed refs
remain Go refs.
"""

from __future__ import annotations

import asyncio
import hashlib
import logging
from dataclasses import dataclass, replace
from typing import Literal, Protocol

from dify_agent.adapters.shell.protocols import ShellCommandProtocol
from dify_agent.adapters.shell.shellctl import ShellctlClientFactory
from dify_agent.runtime_backend.errors import (
    BindingAcquireError,
    BindingCreateError,
    BindingDestroyError,
)
from dify_agent.runtime_backend.protocols import (
    ExecutionBindingAllocation,
    ExecutionBindingBackend,
    ExecutionBindingCreateSpec,
    ExecutionBindingDestroySpec,
    HomeSnapshotBackend,
    HomeSnapshotCreateSpec,
    RuntimeLayout,
    RuntimeLease,
)

type LocalRuntimeImplementation = Literal["go", "rust"]

_GO: LocalRuntimeImplementation = "go"
_RUST: LocalRuntimeImplementation = "rust"
_REF_SEPARATOR = "+"
logger = logging.getLogger(__name__)


class LocalRuntimeHealthProbe(Protocol):
    async def __call__(self) -> None: ...


@dataclass(slots=True)
class ShellctlHealthProbe:
    """Bounded shellctl health probe used only before Rust admission."""

    client_factory: ShellctlClientFactory
    timeout_seconds: float = 1.0

    async def __call__(self) -> None:
        client = self.client_factory()
        try:
            async with asyncio.timeout(self.timeout_seconds):
                response = await client.health()
            if response.status != "ok":
                raise RuntimeError(f"unexpected shellctl health status: {response.status!r}")
        except BaseException:
            try:
                await client.close()
            except BaseException:
                logger.warning("failed to close shellctl client after rollout preflight failure", exc_info=True)
            raise
        await client.close()


@dataclass(frozen=True, slots=True)
class LocalRuntimeTarget:
    implementation: LocalRuntimeImplementation
    home_snapshots: HomeSnapshotBackend
    execution_bindings: ExecutionBindingBackend


@dataclass(slots=True)
class LocalRuntimeRouter:
    """Choose Rust only for new, unpinned Bindings and keep Go as fallback."""

    go: LocalRuntimeTarget
    rust: LocalRuntimeTarget
    rust_canary_percent: int
    rust_health_probe: LocalRuntimeHealthProbe

    def __post_init__(self) -> None:
        if self.go.implementation != _GO or self.rust.implementation != _RUST:
            raise ValueError("local runtime targets must be wired as go and rust")
        if not 0 <= self.rust_canary_percent <= 100:
            raise ValueError("rust_canary_percent must be between 0 and 100")

    def target(self, implementation: LocalRuntimeImplementation) -> LocalRuntimeTarget:
        return self.rust if implementation == _RUST else self.go

    async def select_for_create(self, spec: ExecutionBindingCreateSpec) -> LocalRuntimeImplementation:
        pinned: set[LocalRuntimeImplementation] = {
            _decode_ref(ref).implementation
            for ref in (spec.existing_workspace_ref, spec.home_snapshot_ref)
            if ref is not None
        }
        if len(pinned) > 1:
            raise BindingCreateError("Home Snapshot and existing Workspace belong to different runtime implementations")
        if pinned:
            implementation = pinned.pop()
            if implementation == _RUST:
                await self._require_pinned_rust()
            return implementation

        if not _is_rust_canary(spec, self.rust_canary_percent):
            return _GO

        try:
            await self.rust_health_probe()
        except Exception:
            logger.warning(
                "Rust local runtime preflight failed; assigning new Binding to Go",
                exc_info=True,
                extra={"binding_id": spec.binding_id, "workspace_id": spec.workspace_id},
            )
            return _GO
        logger.info(
            "Assigning new Binding to the Rust local runtime canary",
            extra={
                "binding_id": spec.binding_id,
                "workspace_id": spec.workspace_id,
                "rust_canary_percent": self.rust_canary_percent,
            },
        )
        return _RUST

    async def _require_pinned_rust(self) -> None:
        try:
            await self.rust_health_probe()
        except Exception as exc:
            raise BindingCreateError(
                "Rust runtime is unavailable for a resource already pinned to Rust; refusing unsafe Go replay"
            ) from exc


@dataclass(slots=True)
class RoutedLocalRuntimeLease:
    """Runtime lease tagged with the backend that owns its state."""

    implementation: LocalRuntimeImplementation
    inner: RuntimeLease

    @property
    def layout(self) -> RuntimeLayout:
        return self.inner.layout

    @property
    def commands(self) -> ShellCommandProtocol:
        return self.inner.commands


@dataclass(slots=True)
class RoutedLocalExecutionBindingBackend:
    router: LocalRuntimeRouter

    async def create_binding(self, spec: ExecutionBindingCreateSpec) -> ExecutionBindingAllocation:
        try:
            implementation = await self.router.select_for_create(spec)
            native_spec = replace(
                spec,
                existing_workspace_ref=_native_ref_for(implementation, spec.existing_workspace_ref),
                home_snapshot_ref=_native_ref_for(implementation, spec.home_snapshot_ref),
            )
        except BindingCreateError:
            raise
        except ValueError as exc:
            raise BindingCreateError(str(exc)) from exc

        # Do not catch and replay this call. The selected runtime may already
        # have mutated its Home or Workspace before surfacing an error.
        allocation = await self.router.target(implementation).execution_bindings.create_binding(native_spec)
        return ExecutionBindingAllocation(
            binding_ref=_encode_ref(implementation, allocation.binding_ref),
            workspace_ref=_encode_ref(implementation, allocation.workspace_ref),
        )

    async def acquire(self, binding_ref: str) -> RuntimeLease:
        try:
            routed_ref = _decode_ref(binding_ref)
        except ValueError as exc:
            raise BindingAcquireError(str(exc)) from exc
        lease = await self.router.target(routed_ref.implementation).execution_bindings.acquire(routed_ref.native)
        return RoutedLocalRuntimeLease(implementation=routed_ref.implementation, inner=lease)

    async def release(self, lease: RuntimeLease) -> None:
        if not isinstance(lease, RoutedLocalRuntimeLease):
            raise TypeError("RoutedLocalExecutionBindingBackend can only release its own RuntimeLease")
        await self.router.target(lease.implementation).execution_bindings.release(lease.inner)

    async def destroy_binding(self, spec: ExecutionBindingDestroySpec) -> None:
        try:
            binding_ref = _decode_ref(spec.binding_ref)
            workspace_ref = _decode_ref(spec.workspace_ref) if spec.workspace_ref is not None else None
            if workspace_ref is not None and workspace_ref.implementation != binding_ref.implementation:
                raise ValueError("Workspace and Binding refs belong to different runtime implementations")
            native_spec = replace(
                spec,
                binding_ref=binding_ref.native,
                workspace_ref=workspace_ref.native if workspace_ref is not None else None,
            )
        except ValueError as exc:
            raise BindingDestroyError(str(exc)) from exc
        await self.router.target(binding_ref.implementation).execution_bindings.destroy_binding(native_spec)


@dataclass(slots=True)
class RoutedLocalHomeSnapshotBackend:
    router: LocalRuntimeRouter

    async def create_from_runtime(self, *, spec: HomeSnapshotCreateSpec, source: RuntimeLease) -> str:
        if not isinstance(source, RoutedLocalRuntimeLease):
            raise TypeError("RoutedLocalHomeSnapshotBackend requires a routed local RuntimeLease")
        native_ref = await self.router.target(source.implementation).home_snapshots.create_from_runtime(
            spec=spec,
            source=source.inner,
        )
        return _encode_ref(source.implementation, native_ref)

    async def delete(self, snapshot_ref: str) -> None:
        routed_ref = _decode_ref(snapshot_ref)
        await self.router.target(routed_ref.implementation).home_snapshots.delete(routed_ref.native)


@dataclass(frozen=True, slots=True)
class _RoutedRef:
    implementation: LocalRuntimeImplementation
    native: str


def _encode_ref(implementation: LocalRuntimeImplementation, native: str) -> str:
    if not native:
        raise ValueError("runtime backend ref must not be empty")
    if implementation == _GO:
        return native
    return f"{implementation}{_REF_SEPARATOR}{native}"


def _decode_ref(value: str) -> _RoutedRef:
    if not value:
        raise ValueError("runtime backend ref must not be empty")
    for implementation in (_GO, _RUST):
        prefix = f"{implementation}{_REF_SEPARATOR}"
        if value.startswith(prefix):
            native = value[len(prefix) :]
            if not native:
                raise ValueError("runtime backend ref must include a native ref")
            return _RoutedRef(implementation=implementation, native=native)
    # Refs created before dual-runtime rollout belong to the existing Go
    # implementation. This preserves upgrades and makes rollback deterministic.
    return _RoutedRef(implementation=_GO, native=value)


def _native_ref_for(implementation: LocalRuntimeImplementation, value: str | None) -> str | None:
    if value is None:
        return None
    routed_ref = _decode_ref(value)
    if routed_ref.implementation != implementation:
        raise ValueError("runtime backend ref is pinned to a different implementation")
    return routed_ref.native


def _is_rust_canary(spec: ExecutionBindingCreateSpec, percent: int) -> bool:
    if percent <= 0:
        return False
    if percent >= 100:
        return True
    key = "\0".join((spec.tenant_id, spec.agent_id, spec.binding_id, spec.workspace_id)).encode()
    bucket = int.from_bytes(hashlib.blake2b(key, digest_size=8, usedforsecurity=False).digest(), "big") % 100
    return bucket < percent


__all__ = [
    "LocalRuntimeRouter",
    "LocalRuntimeTarget",
    "RoutedLocalExecutionBindingBackend",
    "RoutedLocalHomeSnapshotBackend",
    "RoutedLocalRuntimeLease",
    "ShellctlHealthProbe",
]
