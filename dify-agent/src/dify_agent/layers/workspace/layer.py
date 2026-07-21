"""Agenton layer that binds the Dify API-owned runtime session workspace ID."""

from dataclasses import dataclass
from typing import ClassVar

from agenton.layers import EmptyRuntimeState, LayerDeps, NoLayerDeps, PlainLayer
from typing_extensions import Self, override

from dify_agent.layers.execution_context import DifyExecutionContextLayerConfig
from dify_agent.layers.workspace.configs import (
    DIFY_WORKSPACE_LAYER_TYPE_ID,
    DifyWorkspaceLayerConfig,
    DifyWorkspaceRuntimeState,
)


@dataclass(frozen=True, slots=True)
class WorkspaceBinding:
    workspace_id: str


class DifyWorkspaceLayerDeps(LayerDeps):
    execution_context: PlainLayer[NoLayerDeps, DifyExecutionContextLayerConfig, EmptyRuntimeState]  # pyright: ignore[reportUninitializedInstanceVariable]


@dataclass(slots=True)
class DifyWorkspaceLayer(PlainLayer[DifyWorkspaceLayerDeps, DifyWorkspaceLayerConfig, DifyWorkspaceRuntimeState]):
    """Expose ``workspace_id == AgentRuntimeSession.id`` without owning storage."""

    type_id: ClassVar[str | None] = DIFY_WORKSPACE_LAYER_TYPE_ID
    config: DifyWorkspaceLayerConfig

    @classmethod
    @override
    def from_config(cls, config: DifyWorkspaceLayerConfig) -> Self:
        return cls(config=DifyWorkspaceLayerConfig.model_validate(config))

    @property
    def binding(self) -> WorkspaceBinding:
        return WorkspaceBinding(workspace_id=self.config.workspace_id)


__all__ = ["DifyWorkspaceLayer", "DifyWorkspaceLayerDeps", "WorkspaceBinding"]
