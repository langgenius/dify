"""Pydantic AI agent construction for models supplied by Agenton layers.

The run request carries model/provider selection in the layer graph. This helper
keeps Agent construction details out of ``AgentRunRunner`` while accepting an
already resolved Pydantic AI model from the configured model layer. Prompt and
tool values arriving here are already transformed by Agenton's
``PYDANTIC_AI_TRANSFORMERS`` preset; this module registers those pydantic-ai
objects without reimplementing plain/pydantic-ai conversion logic. The caller
also passes the already resolved ``output_type`` so legacy text output and the
optional JSON Schema output layer share the same ``Agent`` construction path.
"""

from collections.abc import Sequence
from typing import Any, cast

from pydantic_ai import Agent
from pydantic_ai.messages import UserContent
from pydantic_ai.models import Model
from pydantic_ai.output import OutputSpec

from agenton.layers.types import PydanticAIPrompt, PydanticAITool


def create_agent(
    model: Model[Any],
    *,
    system_prompts: Sequence[PydanticAIPrompt[object]],
    tools: Sequence[PydanticAITool[object]],
    output_type: OutputSpec[object] = str,
) -> Agent[None, object]:
    """Create the pydantic-ai agent for one run.

    ``output_type`` is resolved by the runtime after entering the Agenton run so
    validation and execution both honor the same optional structured output
    contract. For structured output runs the type inside ``output_type`` already
    carries the Pydantic hooks needed for schema exposure and runtime validation,
    so agent construction does not need to register a separate validator.
    """
    agent = cast(Agent[None, object], Agent(model, output_type=output_type, tools=tools))
    for prompt in system_prompts:
        _ = agent.system_prompt(cast(Any, prompt))
    return agent


def normalize_user_input(user_prompts: Sequence[UserContent]) -> str | Sequence[UserContent]:
    """Return the pydantic-ai run input while preserving multi-part prompts."""
    if len(user_prompts) == 1 and isinstance(user_prompts[0], str):
        return user_prompts[0]
    return list(user_prompts)


__all__ = ["create_agent", "normalize_user_input"]
