"""Agenton layer that binds, but never owns, an immutable Home Snapshot ref."""

from dataclasses import dataclass
from typing import ClassVar

from agenton.layers import EmptyRuntimeState, LayerDeps, NoLayerDeps, PlainLayer
from typing_extensions import Self, override

from dify_agent.layers.execution_context import DifyExecutionContextLayerConfig
from dify_agent.layers.home.configs import DIFY_HOME_LAYER_TYPE_ID, DifyHomeLayerConfig, DifyHomeRuntimeState


@dataclass(frozen=True, slots=True)
class HomeSnapshotBinding:
    snapshot_ref: str


class DifyHomeLayerDeps(LayerDeps):
    execution_context: PlainLayer[NoLayerDeps, DifyExecutionContextLayerConfig, EmptyRuntimeState]  # pyright: ignore[reportUninitializedInstanceVariable]


@dataclass(slots=True)
class DifyHomeLayer(PlainLayer[DifyHomeLayerDeps, DifyHomeLayerConfig, DifyHomeRuntimeState]):
    """Expose the config-version-owned ref without creating or deleting it."""

    type_id: ClassVar[str | None] = DIFY_HOME_LAYER_TYPE_ID
    config: DifyHomeLayerConfig

    @classmethod
    @override
    def from_config(cls, config: DifyHomeLayerConfig) -> Self:
        return cls(config=DifyHomeLayerConfig.model_validate(config))

    @property
    def binding(self) -> HomeSnapshotBinding:
        return HomeSnapshotBinding(snapshot_ref=self.config.snapshot_ref)


__all__ = ["DifyHomeLayer", "DifyHomeLayerDeps", "HomeSnapshotBinding"]
