"""Basic ready-to-compose layers for common plain use cases.

These layers are small concrete implementations built on
``agenton.layers.types``. They intentionally stay free of compositor graph
construction so they can be reused from config, examples, and higher-level
dynamic layers.
"""

from collections.abc import Callable, Sequence
from dataclasses import dataclass, field
from typing import Any

from pydantic import BaseModel, ConfigDict, Field

from agenton.layers.base import NoLayerDeps
from agenton.layers.types import PlainLayer


class PromptLayerConfig(BaseModel):
    """Serializable config schema for ``PromptLayer``."""

    prefix: list[str] | str = Field(default_factory=list)
    suffix: list[str] | str = Field(default_factory=list)

    model_config = ConfigDict(extra="forbid")


@dataclass
class ObjectLayer[ObjectT](PlainLayer[NoLayerDeps]):
    """Layer that stores one typed object for downstream dependencies.

    Object layers are instance-only because arbitrary Python objects are not
    serializable graph config. Add them with ``CompositorBuilder.add_instance``.
    """

    value: ObjectT


@dataclass
class PromptLayer(PlainLayer[NoLayerDeps, PromptLayerConfig]):
    """Layer that contributes configured prefix and suffix prompt fragments."""

    type_id = "plain.prompt"

    prefix: list[str] | str = field(default_factory=list)
    suffix: list[str] | str = field(default_factory=list)

    @classmethod
    def from_config(cls, config: BaseModel):
        """Create a prompt layer from validated prompt config."""
        validated_config = PromptLayerConfig.model_validate(config)
        return cls(prefix=validated_config.prefix, suffix=validated_config.suffix)

    @property
    def prefix_prompts(self) -> list[str]:
        if isinstance(self.prefix, str):
            return [self.prefix]
        return self.prefix

    @property
    def suffix_prompts(self) -> list[str]:
        if isinstance(self.suffix, str):
            return [self.suffix]
        return self.suffix


@dataclass
class ToolsLayer(PlainLayer[NoLayerDeps]):
    """Layer that contributes configured plain-callable tools.

    Tool layers are instance-only because Python callables are live objects. Add
    them with ``CompositorBuilder.add_instance``.
    """

    tool_entries: Sequence[Callable[..., Any]] = ()

    @property
    def tools(self) -> list[Callable[..., Any]]:
        return list(self.tool_entries)


__all__ = [
    "ObjectLayer",
    "PromptLayerConfig",
    "PromptLayer",
    "ToolsLayer",
]
