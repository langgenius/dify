"""Inert Dify drive declaration layer.

Registering this layer makes ``dify.drive`` a known composition type id so a
run that carries the declaration never fails as "unknown layer type", even
before the consumption work (ENG-387) lands. It deliberately contributes no
prompt and no tools: a model that can see skill names but cannot read SKILL.md
would only hallucinate. The skills prompt (including the "pull SKILL.md via
drive" guidance) ships together with the consumption implementation.
"""

from dataclasses import dataclass
from typing import ClassVar

from typing_extensions import Self, override

from agenton.layers import EmptyRuntimeState, NoLayerDeps, PlainLayer
from dify_agent.layers.drive.configs import DIFY_DRIVE_LAYER_TYPE_ID, DifyDriveLayerConfig


@dataclass(slots=True)
class DifyDriveLayer(PlainLayer[NoLayerDeps, DifyDriveLayerConfig, EmptyRuntimeState]):
    """Config-only carrier of the drive Skills & Files manifest."""

    type_id: ClassVar[str] = DIFY_DRIVE_LAYER_TYPE_ID

    config: DifyDriveLayerConfig

    @classmethod
    @override
    def from_config(cls, config: DifyDriveLayerConfig) -> Self:
        return cls(config=config)


__all__ = ["DifyDriveLayer"]
