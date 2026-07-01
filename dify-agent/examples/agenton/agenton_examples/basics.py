"""Run with: uv run --project dify-agent python -m agenton_examples.basics."""

from __future__ import annotations

import asyncio
from dataclasses import dataclass, field
from inspect import signature
from typing import cast

from typing_extensions import override

from agenton.compositor import Compositor, LayerNode, LayerProvider
from agenton.layers import LayerDeps, NoLayerDeps, PlainLayer, PlainToolType
from agenton_collections.layers.plain import DynamicToolsLayer, ObjectLayer, PromptLayer, ToolsLayer, with_object
from agenton_collections.layers.plain.basic import PromptLayerConfig


@dataclass(frozen=True, slots=True)
class AgentProfile:
    name: str
    audience: str
    tone: str


class ProfilePromptDeps(LayerDeps):
    profile: ObjectLayer[AgentProfile]  # pyright: ignore[reportUninitializedInstanceVariable]


@dataclass(slots=True)
class ProfilePromptLayer(PlainLayer[ProfilePromptDeps]):
    @property
    @override
    def prefix_prompts(self) -> list[str]:
        profile = self.deps.profile.value
        return [
            f"You are {profile.name}, writing for {profile.audience}.",
            f"Keep the tone {profile.tone}.",
        ]


@dataclass(slots=True)
class TraceLayer(PlainLayer[NoLayerDeps]):
    events: list[str] = field(default_factory=list)

    @override
    async def on_context_create(self) -> None:
        self.events.append("create")

    @override
    async def on_context_suspend(self) -> None:
        self.events.append("suspend")

    @override
    async def on_context_resume(self) -> None:
        self.events.append("resume")

    @override
    async def on_context_delete(self) -> None:
        self.events.append("delete")


def count_words(text: str) -> int:
    return len(text.split())


@with_object(AgentProfile)
def write_tagline(profile: AgentProfile, topic: str) -> str:
    return f"{profile.name}: {topic} for {profile.audience}, in a {profile.tone} voice."


async def main() -> None:
    profile = AgentProfile(
        name="Agenton Assistant",
        audience="engineers composing agent capabilities",
        tone="precise and friendly",
    )
    trace_events: list[str] = []
    compositor = Compositor(
        [
            LayerNode("base_prompt", PromptLayer),
            LayerNode("extra_prompt", PromptLayer),
            LayerNode(
                "profile",
                LayerProvider.from_factory(
                    layer_type=ObjectLayer,
                    create=lambda _config: ObjectLayer[AgentProfile](profile),
                ),
            ),
            LayerNode("profile_prompt", ProfilePromptLayer, deps={"profile": "profile"}),
            LayerNode(
                "tools",
                LayerProvider.from_factory(
                    layer_type=ToolsLayer,
                    create=lambda _config: ToolsLayer(tool_entries=(count_words,)),
                ),
            ),
            LayerNode(
                "dynamic_tools",
                LayerProvider.from_factory(
                    layer_type=DynamicToolsLayer,
                    create=lambda _config: DynamicToolsLayer[AgentProfile](tool_entries=(write_tagline,)),
                ),
                deps={"object_layer": "profile"},
            ),
            LayerNode(
                "trace",
                LayerProvider.from_factory(layer_type=TraceLayer, create=lambda _config: TraceLayer(trace_events)),
            ),
        ]
    )
    configs = {
        "base_prompt": PromptLayerConfig(
            prefix="Use config dicts for serializable layers.",
            user="Explain how the composed agent should use its layers.",
            suffix="Before finalizing, make the result easy to scan.",
        ),
        "extra_prompt": PromptLayerConfig(prefix="Use constructed instances for objects, local code, and callables."),
    }

    async with compositor.enter(configs=configs) as run:
        print("Prompts:")
        for prompt in run.prompts:
            print(f"- {prompt.value}")

        print("\nUser prompts:")
        for prompt in run.user_prompts:
            print(f"- {prompt.value}")

        print("\nTools:")
        plain_tools = [cast(PlainToolType, tool) for tool in run.tools]
        for tool in plain_tools:
            print(f"- {tool.value.__name__}{signature(tool.value)}")
        print([tool.value("layer composition") for tool in plain_tools])
        run.suspend_on_exit()

    async with compositor.enter(configs=configs, session_snapshot=run.session_snapshot):
        pass
    print("\nLifecycle:", trace_events)


if __name__ == "__main__":
    asyncio.run(main())
