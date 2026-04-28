"""Basic ready-to-compose layers for common plain use cases.

These layers are small concrete implementations built on
``agenton.layers.types``. They intentionally stay free of compositor graph
construction so they can be reused from config, examples, and higher-level
dynamic layers.
"""

from collections.abc import Callable, Sequence
from dataclasses import dataclass, field
from typing import Any

from pydantic import TypeAdapter

from agenton.layers.base import NoLayerDeps
from agenton.layers.types import PlainLayer


@dataclass
class ObjectLayer[ObjectT](PlainLayer[NoLayerDeps]):
    """Layer that stores one typed object for downstream dependencies."""

    value: ObjectT


@dataclass
class PromptLayer(PlainLayer[NoLayerDeps]):
    """Layer that contributes configured prefix and suffix prompt fragments."""

    prefix: list[str] | str = field(default_factory=list)
    suffix: list[str] | str = field(default_factory=list)

    @classmethod
    def from_config(cls, config: Any):
        """Validate prompt config against this dataclass."""
        return _PROMPT_LAYER_ADAPTER.validate_python(config)

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
    """Layer that contributes configured plain-callable tools."""

    tool_entries: Sequence[Callable[..., Any]] = ()

    @property
    def tools(self) -> list[Callable[..., Any]]:
        return list(self.tool_entries)


_PROMPT_LAYER_ADAPTER = TypeAdapter(PromptLayer)

__all__ = [
    "ObjectLayer",
    "PromptLayer",
    "ToolsLayer",
]
