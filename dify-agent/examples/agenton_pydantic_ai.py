"""Run with: uv run --project dify-agent python examples/agenton_pydantic_ai.py."""

from __future__ import annotations

from dataclasses import dataclass
from typing import cast

from pydantic_ai import Agent, RunContext, Tool
from pydantic_ai.messages import ToolCallPart, BuiltinToolCallPart
from pydantic_ai.models.test import TestModel

from agenton.compositor import Compositor, CompositorLayerConfig
from agenton.layers.types import AllPromptTypes, AllToolTypes, PydanticAIPrompt, PydanticAITool
from agenton_collections.layers.plain import ObjectLayer, ToolsLayer
from agenton_collections.layers.pydantic_ai import PydanticAIBridgeLayer
from agenton_collections.transformers import PYDANTIC_AI_TRANSFORMERS


import json
@dataclass(frozen=True, slots=True)
class AgentProfile:
    name: str
    audience: str
    tone: str


def count_words(text: str) -> int:
    return len(text.split())


def profile_prompt(ctx: RunContext[AgentProfile]) -> str:
    profile = ctx.deps
    return f"You are {profile.name}, helping {profile.audience}."


def tone_prompt(ctx: RunContext[AgentProfile]) -> str:
    return f"Keep responses {ctx.deps.tone}."


def write_tagline(ctx: RunContext[AgentProfile], topic: str) -> str:
    profile = ctx.deps
    return f"{profile.name}: {topic} for {profile.audience}, in a {profile.tone} voice."


async def main() -> None:
    profile = AgentProfile(
        name="Agenton Assistant",
        audience="engineers composing agent capabilities",
        tone="precise and friendly",
    )
    pydantic_ai_bridge = PydanticAIBridgeLayer[AgentProfile](
        prefix=(profile_prompt, tone_prompt),
        tool_entries=(Tool(write_tagline),),
    )

    compositor = Compositor[
        PydanticAIPrompt[object],
        PydanticAITool[object],
        AllPromptTypes,
        AllToolTypes,
    ].from_config(
        {
            "layers": [
                {
                    "name": "base_prompt",
                    "layer": {
                        "import_path": "agenton_collections.layers.plain:PromptLayer",
                        "config": {
                            "prefix": "Use the available tools before answering.",
                            "suffix": "Return concise, inspectable output.",
                        },
                    },
                },
                CompositorLayerConfig(
                    name="profile",
                    layer=ObjectLayer[AgentProfile](profile),
                ),
                CompositorLayerConfig(
                    name="plain_tools",
                    layer=ToolsLayer(tool_entries=(count_words,)),
                ),
                CompositorLayerConfig(
                    name="pydantic_ai_bridge",
                    deps={"object_layer": "profile"},
                    layer=pydantic_ai_bridge,
                ),
            ]
        },
        **PYDANTIC_AI_TRANSFORMERS,
    )

    async with compositor.enter():
        agent = Agent[AgentProfile](
            model=TestModel(call_tools=["count_words", "write_tagline"]),
            deps_type=AgentProfile,
            tools=compositor.tools,
        )
        for prompt in compositor.prompts:
            agent.system_prompt(prompt)

        result = await agent.run(
            "Use the tools for 'layer composition'.",
            deps=pydantic_ai_bridge.run_deps,
        )

    for message in result.all_messages():
        for part in message.parts:
            print(f"{type(part).__name__}: {part.content if not isinstance(part, (ToolCallPart, BuiltinToolCallPart)) else part.tool_name + '(' + json.dumps(part.args, ensure_ascii=False) + ')'}")


if __name__ == "__main__":
    import asyncio
    asyncio.run(main())
