"""Pydantic AI compositor transformer presets.

This module owns the pydantic-ai runtime dependency for transforming tagged
agenton system prompt, user prompt, and tool items into pydantic-ai-compatible
items.
"""

from collections.abc import Sequence
from typing import Final

from pydantic_ai import Tool

from agenton.compositor import CompositorTransformerKwargs
from agenton.layers.types import (
    AllPromptTypes,
    AllToolTypes,
    AllUserPromptTypes,
    PydanticAIPrompt,
    PydanticAITool,
    PydanticAIUserPrompt,
)

type PydanticAICompositorTransformerKwargs = CompositorTransformerKwargs[
    PydanticAIPrompt[object],
    PydanticAITool[object],
    AllPromptTypes,
    AllToolTypes,
    PydanticAIUserPrompt,
    AllUserPromptTypes,
]


def _pydantic_ai_prompt_transformer(
    prompts: Sequence[AllPromptTypes],
) -> list[PydanticAIPrompt[object]]:
    result: list[PydanticAIPrompt[object]] = []
    for prompt in prompts:
        if prompt.kind == "plain":
            result.append((lambda value: lambda: value)(prompt.value))
        elif prompt.kind == "pydantic_ai":
            result.append(prompt.value)
        else:
            raise NotImplementedError(f"Unsupported prompt type: {type(prompt).__qualname__}.")
    return result


def _pydantic_ai_user_prompt_transformer(
    prompts: Sequence[AllUserPromptTypes],
) -> list[PydanticAIUserPrompt]:
    result: list[PydanticAIUserPrompt] = []
    for prompt in prompts:
        if prompt.kind == "plain":
            result.append(prompt.value)
        elif prompt.kind == "pydantic_ai":
            result.append(prompt.value)
        else:
            raise NotImplementedError(f"Unsupported user prompt type: {type(prompt).__qualname__}.")
    return result


def _pydantic_ai_tool_transformer(
    tools: Sequence[AllToolTypes],
) -> list[PydanticAITool[object]]:
    result: list[PydanticAITool[object]] = []
    for tool in tools:
        if tool.kind == "plain":
            result.append(Tool(tool.value))
        elif tool.kind == "pydantic_ai":
            result.append(tool.value)
        else:
            raise NotImplementedError(f"Unsupported tool type: {type(tool).__qualname__}.")
    return result


PYDANTIC_AI_TRANSFORMERS: Final[PydanticAICompositorTransformerKwargs] = {
    "prompt_transformer": _pydantic_ai_prompt_transformer,
    "user_prompt_transformer": _pydantic_ai_user_prompt_transformer,
    "tool_transformer": _pydantic_ai_tool_transformer,
}


__all__ = [
    "PYDANTIC_AI_TRANSFORMERS",
    "PydanticAICompositorTransformerKwargs",
]
