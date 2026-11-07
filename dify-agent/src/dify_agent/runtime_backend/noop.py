"""Home Snapshot backend for deployments with no snapshot capability.

``create_from_runtime`` returns ``None`` — the protocol's explicit "no
snapshot captured" result — and ``delete`` is a no-op. Both perform no I/O;
callers see an honest absent result rather than a fake reference.
"""

from __future__ import annotations

from dify_agent.runtime_backend.protocols import HomeSnapshotCreateSpec, RuntimeLease


class NoopHomeSnapshotBackend:
    """Reports snapshotting unsupported; deletes succeed idempotently."""

    async def create_from_runtime(self, *, spec: HomeSnapshotCreateSpec, source: RuntimeLease) -> None:
        return None

    async def delete(self, snapshot_ref: str) -> None:
        return None


__all__ = ["NoopHomeSnapshotBackend"]
