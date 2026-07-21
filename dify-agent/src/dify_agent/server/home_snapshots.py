"""Stateless application facade for deployment-owned Home Snapshots.

The service has no resource catalog. Initialization delegates directly to the
selected backend. Build Apply resumes exactly the Sandbox described by the
caller-provided locator, snapshots its invocation-local lease, and suspends the
source again without deleting it.
"""

from __future__ import annotations

from dataclasses import dataclass

from dify_agent.layers.execution_context import DifyExecutionContextLayerConfig
from dify_agent.layers.sandbox.layer import DifySandboxLayer
from dify_agent.protocol import normalize_composition
from dify_agent.protocol.home_snapshot import (
    CreateHomeSnapshotFromSandboxRequest,
    HomeSnapshotResponse,
    InitializeHomeSnapshotRequest,
)
from dify_agent.runtime.compositor_factory import DifyAgentLayerProvider, build_pydantic_ai_compositor
from dify_agent.runtime_backend import (
    HomeSnapshotCreateSpec,
    HomeSnapshotDriver,
    InitializeHomeSnapshotSpec,
)
from dify_agent.runtime_backend.errors import (
    HomeSnapshotCreateError,
    HomeSnapshotNotFoundError,
    SandboxLostError,
    SandboxResumeError,
)


class HomeSnapshotServiceError(RuntimeError):
    """Application error carrying the private route's stable code and status."""

    def __init__(self, code: str, message: str, *, status_code: int) -> None:
        super().__init__(message)
        self.code = code
        self.message = message
        self.status_code = status_code


@dataclass(slots=True)
class HomeSnapshotService:
    """Execute final Home lifecycle operations without retaining mappings."""

    driver: HomeSnapshotDriver
    layer_providers: tuple[DifyAgentLayerProvider, ...]

    async def initialize(self, request: InitializeHomeSnapshotRequest) -> HomeSnapshotResponse:
        """Create one backend-native initial Home resource."""
        try:
            snapshot_ref = await self.driver.initialize(
                InitializeHomeSnapshotSpec(
                    tenant_id=request.tenant_id,
                    agent_id=request.agent_id,
                    home_snapshot_id=request.home_snapshot_id,
                )
            )
        except HomeSnapshotCreateError as exc:
            raise HomeSnapshotServiceError("home_snapshot_create_failed", str(exc), status_code=502) from exc
        return HomeSnapshotResponse(snapshot_ref=snapshot_ref)

    async def create_from_sandbox(
        self,
        request: CreateHomeSnapshotFromSandboxRequest,
    ) -> HomeSnapshotResponse:
        """Resume and snapshot exactly the retained Sandbox in ``request``."""
        try:
            graph_config, layer_configs = normalize_composition(request.source_sandbox.composition)
            execution_context = DifyExecutionContextLayerConfig.model_validate(layer_configs["execution_context"])
            if (
                execution_context.tenant_id != request.tenant_id
                or execution_context.agent_id != request.agent_id
                or execution_context.agent_config_version_kind != "build_draft"
            ):
                raise ValueError("source Sandbox must be the requested Agent's Build Draft")
            compositor = build_pydantic_ai_compositor(graph_config, providers=self.layer_providers)
            async with compositor.enter(
                configs=layer_configs,
                session_snapshot=request.source_sandbox.session_snapshot,
            ) as run:
                run.suspend_on_exit()
                sandbox = run.get_layer("sandbox", DifySandboxLayer)
                snapshot_ref = await self.driver.create_from_sandbox(
                    spec=HomeSnapshotCreateSpec(
                        tenant_id=request.tenant_id,
                        agent_id=request.agent_id,
                        home_snapshot_id=request.home_snapshot_id,
                    ),
                    source=sandbox.lease,
                )
        except (KeyError, TypeError, ValueError) as exc:
            raise HomeSnapshotServiceError("invalid_sandbox_locator", str(exc), status_code=400) from exc
        except SandboxLostError as exc:
            raise HomeSnapshotServiceError("sandbox_not_found", str(exc), status_code=404) from exc
        except (SandboxResumeError, HomeSnapshotCreateError) as exc:
            raise HomeSnapshotServiceError("home_snapshot_create_failed", str(exc), status_code=502) from exc
        return HomeSnapshotResponse(snapshot_ref=snapshot_ref)

    async def delete(self, snapshot_ref: str) -> None:
        """Delete one backend Home ref, treating confirmed absence as success."""
        try:
            await self.driver.delete(snapshot_ref)
        except HomeSnapshotNotFoundError:
            return
        except RuntimeError as exc:
            raise HomeSnapshotServiceError("home_snapshot_delete_failed", str(exc), status_code=502) from exc


__all__ = ["HomeSnapshotService", "HomeSnapshotServiceError"]
