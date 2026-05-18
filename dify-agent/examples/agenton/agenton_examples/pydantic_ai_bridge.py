"""Pydantic AI bridge example for use from a source checkout.

`agenton_examples` is not part of the published package, so run this module from
the repository root with:

    PYTHONPATH=dify-agent/src:dify-agent/examples/agenton \
    uv run --project dify-agent python -m agenton_examples.pydantic_ai_bridge
"""

from __future__ import annotations

import asyncio
import json
import os
from dataclasses import dataclass

from pydantic_ai import Agent, RunContext
from pydantic_ai.messages import BuiltinToolCallPart, ModelMessage, ToolCallPart
from pydantic_ai.models.openai import OpenAIChatModel  # pyright: ignore[reportDeprecated]
from pydantic_ai.models.test import TestModel

from agenton.compositor import Compositor, LayerNode, LayerProvider
from agenton_collections.layers.plain import ObjectLayer, PromptLayer, PromptLayerConfig, ToolsLayer
from agenton_collections.layers.pydantic_ai import PydanticAIBridgeLayer
from agenton_collections.transformers.pydantic_ai import PYDANTIC_AI_TRANSFORMERS


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
    compositor = Compositor(
        [
            LayerNode("base_prompt", PromptLayer),
            LayerNode(
                "profile",
                LayerProvider.from_factory(
                    layer_type=ObjectLayer,
                    create=lambda _config: ObjectLayer[AgentProfile](profile),
                ),
            ),
            LayerNode(
                "plain_tools",
                LayerProvider.from_factory(
                    layer_type=ToolsLayer,
                    create=lambda _config: ToolsLayer(tool_entries=(count_words,)),
                ),
            ),
            LayerNode(
                "pydantic_ai_bridge",
                LayerProvider.from_factory(
                    layer_type=PydanticAIBridgeLayer,
                    create=lambda _config: PydanticAIBridgeLayer[AgentProfile](
                        prefix=("Prefer concrete details.", profile_prompt, tone_prompt),
                        user="Use the tools for 'layer composition'.",
                        tool_entries=(write_tagline,),
                    ),
                ),
                deps={"object_layer": "profile"},
            ),
        ],
        **PYDANTIC_AI_TRANSFORMERS,
    )

    async with compositor.enter(
        configs={
            "base_prompt": PromptLayerConfig(
                prefix="Use the available tools before answering.",
                suffix="Return concise, inspectable output.",
            )
        }
    ) as run:
        model = (
            OpenAIChatModel("gpt-5.5")  # pyright: ignore[reportDeprecated]
            if os.getenv("OPENAI_API_KEY")
            else TestModel()
        )
        agent = Agent[AgentProfile](
            model=model,
            deps_type=AgentProfile,
            tools=run.tools,
        )
        for prompt in run.prompts:
            _ = agent.system_prompt(prompt)

        bridge_layer = run.get_layer("pydantic_ai_bridge", PydanticAIBridgeLayer)
        result = await agent.run(run.user_prompts, deps=bridge_layer.run_deps)

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
