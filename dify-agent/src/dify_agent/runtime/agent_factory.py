"""Pydantic AI agent construction for runtime profiles.

The initial server exposes only a credential-free ``test`` profile. The factory
keeps model selection out of ``AgentRunRunner`` so production model profiles can
be added without changing storage or HTTP contracts.
"""

from collections.abc import Sequence
from typing import Callable, cast

from pydantic_ai import Agent
from pydantic_ai.messages import UserContent
from pydantic_ai.models.test import TestModel

from agenton.layers.types import PydanticAIPrompt, PydanticAITool
from dify_agent.server.schemas import AgentProfileConfig


def create_agent(
    profile: AgentProfileConfig,
    *,
    system_prompts: Sequence[PydanticAIPrompt[object]],
    tools: Sequence[PydanticAITool[object]],
) -> Agent[None, str]:
    """Create the pydantic-ai agent for one run."""
    if profile.provider == "test":
        return Agent[None, str](
            TestModel(custom_output_text=profile.output_text),
            output_type=str,
            system_prompt=materialize_static_system_prompts(system_prompts),
            tools=tools,
        )
    raise ValueError(f"Unsupported agent profile provider: {profile.provider}")


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
