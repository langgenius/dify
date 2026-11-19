"""Native Pydantic AI agent construction for one module run."""

from collections.abc import Sequence
from typing import Any, Final, cast

from pydantic_ai import Agent
from pydantic_ai.capabilities import AbstractCapability
from pydantic_ai.messages import UserContent
from pydantic_ai.models import Model
from pydantic_ai.output import OutputSpec
from pydantic_ai.toolsets import AbstractToolset

from dify_agent.runtime.context import Deps

DIFY_AGENT_RUN_NAME: Final[str] = "dify-agent"


def create_agent(
    model: Model[Any],
    *,
    toolsets: Sequence[AbstractToolset[Deps]],
    capabilities: Sequence[AbstractCapability[Deps]],
    output_type: OutputSpec[object] = str,
) -> Agent[Deps, object]:
    """Use native instructions, tool dispatch, ordering and capability hooks."""
    agent = cast(
        Agent[Deps, object],
        Agent(
            model,
            name=DIFY_AGENT_RUN_NAME,
            deps_type=Deps,
            output_type=output_type,
            toolsets=toolsets,
            capabilities=capabilities,
        ),
    )
    agent.instrument = False
    return agent


def normalize_user_input(user_prompts: Sequence[UserContent]) -> str | Sequence[UserContent]:
    if len(user_prompts) == 1 and isinstance(user_prompts[0], str):
        return user_prompts[0]
    return list(user_prompts)
