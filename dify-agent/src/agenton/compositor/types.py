"""Shared generic compositor types.

This module contains the generic prompt/tool type variables and transformer
contracts shared by compositor runtime and orchestration modules. It depends
only on layer base/types modules so higher-level compositor modules can import
it without creating cycles.
"""

from collections.abc import Callable, Sequence
from typing import Any, TypedDict

from typing_extensions import TypeVar

from agenton.layers.base import Layer
from agenton.layers.types import AllPromptTypes, AllToolTypes, AllUserPromptTypes

PromptT = TypeVar("PromptT", default=AllPromptTypes)
ToolT = TypeVar("ToolT", default=AllToolTypes)
LayerPromptT = TypeVar("LayerPromptT", default=AllPromptTypes)
LayerToolT = TypeVar("LayerToolT", default=AllToolTypes)
UserPromptT = TypeVar("UserPromptT", default=AllUserPromptTypes)
LayerUserPromptT = TypeVar("LayerUserPromptT", default=AllUserPromptTypes)
LayerT = TypeVar("LayerT", bound=Layer[Any, Any, Any, Any, Any, Any])


type CompositorTransformer[InputT, OutputT] = Callable[[Sequence[InputT]], Sequence[OutputT]]


class CompositorTransformerKwargs[
    PromptT,
    ToolT,
    LayerPromptT,
    LayerToolT,
    UserPromptT,
    LayerUserPromptT,
](TypedDict):
    """Keyword arguments that install prompt, user prompt, and tool transformers.

    The required keys intentionally mirror the keyword-only transformer
    parameters exposed by ``Compositor.__init__`` and
    ``Compositor.from_config(...)``.
    """

    prompt_transformer: CompositorTransformer[LayerPromptT, PromptT]
    user_prompt_transformer: CompositorTransformer[LayerUserPromptT, UserPromptT]
    tool_transformer: CompositorTransformer[LayerToolT, ToolT]
