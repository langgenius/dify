"""Pydantic AI agent construction for models supplied by Agenton layers.

The run request carries model/provider selection in the layer graph. This helper
keeps Agent construction details out of ``AgentRunRunner`` while accepting an
already resolved Pydantic AI model from the configured model layer.
"""

from collections.abc import Sequence
from typing import Any, Callable, cast

from pydantic_ai import Agent
from pydantic_ai.messages import UserContent
from pydantic_ai.models import Model

from agenton.layers.types import PydanticAIPrompt, PydanticAITool


def create_agent(
    model: Model[Any],
    *,
    system_prompts: Sequence[PydanticAIPrompt[object]],
    tools: Sequence[PydanticAITool[object]],
) -> Agent[None, object]:
    """Create the pydantic-ai agent for one run."""
    return cast(
        Agent[None, object],
        Agent[None, str](
            model,
            output_type=str,
            system_prompt=materialize_static_system_prompts(system_prompts),
            tools=tools,
        ),
    )


def materialize_static_system_prompts(system_prompts: Sequence[PydanticAIPrompt[object]]) -> list[str]:
    """Convert MVP static prompt callables into strings for pydantic-ai."""
    result: list[str] = []
    for prompt in system_prompts:
        if isinstance(prompt, str):
            result.append(prompt)
        elif callable(prompt):
            result.append(cast(Callable[[], str], prompt)())
        else:
            raise TypeError(f"Unsupported system prompt type: {type(prompt).__qualname__}")
    return result


def normalize_user_input(user_prompts: Sequence[UserContent]) -> str | Sequence[UserContent]:
    """Return the pydantic-ai run input while preserving multi-part prompts."""
    if len(user_prompts) == 1 and isinstance(user_prompts[0], str):
        return user_prompts[0]
    return list(user_prompts)


__all__ = ["create_agent", "materialize_static_system_prompts", "normalize_user_input"]
