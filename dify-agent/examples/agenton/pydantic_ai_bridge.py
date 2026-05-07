"""Run with: uv run --project dify-agent python examples/agenton/pydantic_ai_bridge.py."""

from __future__ import annotations

import asyncio
import json
import os
from dataclasses import dataclass

from pydantic_ai import Agent, RunContext
from pydantic_ai.messages import BuiltinToolCallPart, ModelMessage, ToolCallPart
from pydantic_ai.models.openai import OpenAIChatModel  # pyright: ignore[reportDeprecated]
from pydantic_ai.models.test import TestModel

from agenton.compositor import CompositorBuilder, LayerRegistry
from agenton_collections.layers.plain import ObjectLayer, PromptLayer, ToolsLayer
from agenton_collections.layers.pydantic_ai import PydanticAIBridgeLayer
from agenton_collections.transformers import PYDANTIC_AI_TRANSFORMERS


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
        prefix=("Prefer concrete details.", profile_prompt, tone_prompt),
        tool_entries=(write_tagline,),
    )

    registry = LayerRegistry()
    registry.register_layer(PromptLayer)
    compositor = (
        CompositorBuilder(registry)
        .add_config(
            {
                "layers": [
                    {
                        "name": "base_prompt",
                        "type": "plain.prompt",
                        "config": {
                            "prefix": "Use the available tools before answering.",
                            "suffix": "Return concise, inspectable output.",
                        },
                    },
                ]
            }
        )
        .add_instance(name="profile", layer=ObjectLayer[AgentProfile](profile))
        .add_instance(name="plain_tools", layer=ToolsLayer(tool_entries=(count_words,)))
        .add_instance(
            name="pydantic_ai_bridge",
            deps={"object_layer": "profile"},
            layer=pydantic_ai_bridge,
        )
        .build(**PYDANTIC_AI_TRANSFORMERS)
    )

    async with compositor.enter():
        model = (
            OpenAIChatModel("gpt-5.5")  # pyright: ignore[reportDeprecated]
            if os.getenv("OPENAI_API_KEY")
            else TestModel()
        )
        agent = Agent[AgentProfile](
            model=model,
            deps_type=AgentProfile,
            tools=compositor.tools,
        )
        for prompt in compositor.prompts:
            _ = agent.system_prompt(prompt)

        result = await agent.run(
            "Use the tools for 'layer composition'.",
            deps=pydantic_ai_bridge.run_deps,
        )

    for line in _format_messages(result.all_messages()):
        print(line)


def _format_messages(messages: list[ModelMessage]) -> list[str]:
    lines: list[str] = []
    for message in messages:
        for part in message.parts:
            if isinstance(part, ToolCallPart | BuiltinToolCallPart):
                args = json.dumps(part.args, ensure_ascii=False)
                lines.append(f"{type(part).__name__}: {part.tool_name}({args})")
            else:
                lines.append(f"{type(part).__name__}: {part.content}")
    return lines


if __name__ == "__main__":
    asyncio.run(main())
