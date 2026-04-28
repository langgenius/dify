"""Type-inference helpers for compositor construction.

The core ``Compositor`` stays framework-neutral and usually needs explicit
prompt/tool type parameters. ``make_compositor`` is a small runtime factory
whose overloads let type checkers infer prompt and tool unions from the layer
arguments without introducing annotation-only compositor aliases.
"""

from __future__ import annotations

from collections import OrderedDict
from typing import TYPE_CHECKING, Any, Mapping, overload

from agenton.layers.base import Layer

if TYPE_CHECKING:
    from . import Compositor

type NamedLayer[PromptT, ToolT] = tuple[str, Layer[Any, PromptT, ToolT]]


@overload
def make_compositor[PromptT1, ToolT1](
    layer1: NamedLayer[PromptT1, ToolT1],
    /,
    *,
    deps_name_mapping: Mapping[str, Mapping[str, str]] | None = None,
) -> Compositor[PromptT1, ToolT1]: ...


@overload
def make_compositor[PromptT1, ToolT1, PromptT2, ToolT2](
    layer1: NamedLayer[PromptT1, ToolT1],
    layer2: NamedLayer[PromptT2, ToolT2],
    /,
    *,
    deps_name_mapping: Mapping[str, Mapping[str, str]] | None = None,
) -> Compositor[PromptT1 | PromptT2, ToolT1 | ToolT2]: ...


@overload
def make_compositor[PromptT1, ToolT1, PromptT2, ToolT2, PromptT3, ToolT3](
    layer1: NamedLayer[PromptT1, ToolT1],
    layer2: NamedLayer[PromptT2, ToolT2],
    layer3: NamedLayer[PromptT3, ToolT3],
    /,
    *,
    deps_name_mapping: Mapping[str, Mapping[str, str]] | None = None,
) -> Compositor[PromptT1 | PromptT2 | PromptT3, ToolT1 | ToolT2 | ToolT3]: ...


@overload
def make_compositor[
    PromptT1,
    ToolT1,
    PromptT2,
    ToolT2,
    PromptT3,
    ToolT3,
    PromptT4,
    ToolT4,
](
    layer1: NamedLayer[PromptT1, ToolT1],
    layer2: NamedLayer[PromptT2, ToolT2],
    layer3: NamedLayer[PromptT3, ToolT3],
    layer4: NamedLayer[PromptT4, ToolT4],
    /,
    *,
    deps_name_mapping: Mapping[str, Mapping[str, str]] | None = None,
) -> Compositor[PromptT1 | PromptT2 | PromptT3 | PromptT4, ToolT1 | ToolT2 | ToolT3 | ToolT4]: ...


@overload
def make_compositor[
    PromptT1,
    ToolT1,
    PromptT2,
    ToolT2,
    PromptT3,
    ToolT3,
    PromptT4,
    ToolT4,
    PromptT5,
    ToolT5,
](
    layer1: NamedLayer[PromptT1, ToolT1],
    layer2: NamedLayer[PromptT2, ToolT2],
    layer3: NamedLayer[PromptT3, ToolT3],
    layer4: NamedLayer[PromptT4, ToolT4],
    layer5: NamedLayer[PromptT5, ToolT5],
    /,
    *,
    deps_name_mapping: Mapping[str, Mapping[str, str]] | None = None,
) -> Compositor[
    PromptT1 | PromptT2 | PromptT3 | PromptT4 | PromptT5,
    ToolT1 | ToolT2 | ToolT3 | ToolT4 | ToolT5,
]: ...


def make_compositor(
    *layers: NamedLayer[Any, Any],
    deps_name_mapping: Mapping[str, Mapping[str, str]] | None = None,
) -> Compositor[Any, Any]:
    """Create a compositor while letting type checkers infer layer item unions."""
    from . import Compositor

    return Compositor(
        layers=OrderedDict(layers),
        deps_name_mapping=deps_name_mapping or {},
    )
