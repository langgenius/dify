"""Pydantic AI agent construction for models supplied by Agenton layers.

The run request carries model/provider selection in the layer graph. This helper
keeps Agent construction details out of ``AgentRunRunner`` while accepting an
already resolved Pydantic AI model from the configured model layer. Tool values
arriving here are already transformed by Agenton's
``PYDANTIC_AI_TRANSFORMERS`` preset. The runner passes Dify system prompts as
run-level instructions and the context compaction capability directly to
``Agent.run``. The caller also passes the already resolved ``output_type`` so legacy text output and the
optional JSON Schema output layer share the same ``Agent`` construction path.
"""

from collections.abc import Sequence
from typing import Any, Final, cast

from pydantic_ai import Agent
from pydantic_ai.messages import UserContent
from pydantic_ai.models import Model
from pydantic_ai.output import OutputSpec

from agenton.layers.types import PydanticAITool


DIFY_AGENT_RUN_NAME: Final[str] = "dify-agent"


def create_agent(
    model: Model[Any],
    *,
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
    # TODO: propagate roster name, so gen_ai.agent.name can pick that up
    agent = cast(
        Agent[None, object],
        Agent(model, name=DIFY_AGENT_RUN_NAME, output_type=output_type, tools=tools),
    )
    agent.instrument = False
    return agent


def normalize_user_input(user_prompts: Sequence[UserContent]) -> str | Sequence[UserContent]:
    """Return the pydantic-ai run input while preserving multi-part prompts."""
    if len(user_prompts) == 1 and isinstance(user_prompts[0], str):
        return user_prompts[0]
    return list(user_prompts)


__all__ = ["DIFY_AGENT_RUN_NAME", "create_agent", "normalize_user_input"]
