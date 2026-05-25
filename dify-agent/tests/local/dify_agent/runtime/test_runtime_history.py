import asyncio

import pytest
from pydantic_ai.messages import ModelRequest, ModelResponse, SystemPromptPart, TextPart, UserPromptPart

from agenton.compositor import Compositor, LayerNode
from agenton_collections.layers.pydantic_ai import (
    PYDANTIC_AI_HISTORY_LAYER_TYPE_ID,
    PydanticAIHistoryLayer,
)
from dify_agent.protocol import DIFY_AGENT_HISTORY_LAYER_ID
from dify_agent.protocol.schemas import RunComposition, RunLayerSpec
from dify_agent.runtime.compositor_factory import create_default_layer_providers
from dify_agent.runtime.history import (
    append_successful_run_history,
    build_run_message_history,
    get_history_layer,
    validate_history_layer_composition,
)


def test_default_layer_providers_include_pydantic_ai_history_layer() -> None:
    providers = create_default_layer_providers()

    assert PYDANTIC_AI_HISTORY_LAYER_TYPE_ID in {provider.type_id for provider in providers}


def test_validate_history_layer_composition_accepts_absent_or_reserved_history_layer() -> None:
    validate_history_layer_composition(RunComposition(layers=[]))
    validate_history_layer_composition(
        RunComposition(
            layers=[
                RunLayerSpec(
                    name=DIFY_AGENT_HISTORY_LAYER_ID,
                    type=PYDANTIC_AI_HISTORY_LAYER_TYPE_ID,
                )
            ]
        )
    )


def test_validate_history_layer_composition_rejects_multiple_history_layers() -> None:
    composition = RunComposition(
        layers=[
            RunLayerSpec(name=DIFY_AGENT_HISTORY_LAYER_ID, type=PYDANTIC_AI_HISTORY_LAYER_TYPE_ID),
            RunLayerSpec(name="secondary-history", type=PYDANTIC_AI_HISTORY_LAYER_TYPE_ID),
        ]
    )

    with pytest.raises(ValueError, match="Only one 'pydantic_ai.history' layer is supported"):
        validate_history_layer_composition(composition)


def test_validate_history_layer_composition_rejects_misnamed_history_layer() -> None:
    composition = RunComposition(
        layers=[
            RunLayerSpec(name="chat-history", type=PYDANTIC_AI_HISTORY_LAYER_TYPE_ID),
        ]
    )

    with pytest.raises(ValueError, match="must use reserved layer name 'history'"):
        validate_history_layer_composition(composition)


def test_validate_history_layer_composition_rejects_history_layer_dependencies() -> None:
    composition = RunComposition(
        layers=[
            RunLayerSpec(
                name=DIFY_AGENT_HISTORY_LAYER_ID,
                type=PYDANTIC_AI_HISTORY_LAYER_TYPE_ID,
                deps={"prompt": "prompt"},
            )
        ]
    )

    with pytest.raises(ValueError, match="does not support dependencies"):
        validate_history_layer_composition(composition)


def test_get_history_layer_returns_optional_active_history_layer() -> None:
    compositor = Compositor([LayerNode(DIFY_AGENT_HISTORY_LAYER_ID, PydanticAIHistoryLayer)])

    async def scenario() -> None:
        async with compositor.enter() as run:
            history_layer = get_history_layer(run)

            assert isinstance(history_layer, PydanticAIHistoryLayer)

    asyncio.run(scenario())


def test_build_run_message_history_renders_current_system_prompts_before_stored_history() -> None:
    stored_history = [
        ModelRequest(parts=[UserPromptPart(content="old user")]),
        ModelResponse(parts=[TextPart(content="old assistant")]),
    ]

    async def scenario() -> None:
        message_history = await build_run_message_history(
            system_prompts=[lambda: "current system", lambda: "current suffix"],
            stored_history=stored_history,
        )

        assert message_history is not None
        assert isinstance(message_history[0], ModelRequest)
        assert [part.content for part in message_history[0].parts] == ["current system", "current suffix"]
        assert message_history[1:] == stored_history

    asyncio.run(scenario())


def test_build_run_message_history_returns_none_without_system_prompt_or_history() -> None:
    async def scenario() -> None:
        assert await build_run_message_history(system_prompts=[], stored_history=[]) is None

    asyncio.run(scenario())


def test_build_run_message_history_renders_system_prompt_without_history_layer() -> None:
    async def scenario() -> None:
        message_history = await build_run_message_history(system_prompts=[lambda: "current system"], stored_history=[])

        assert message_history is not None
        assert len(message_history) == 1
        assert isinstance(message_history[0], ModelRequest)
        assert isinstance(message_history[0].parts[0], SystemPromptPart)
        assert message_history[0].parts[0].content == "current system"

    asyncio.run(scenario())


def test_build_run_message_history_rejects_context_dependent_prompt_functions() -> None:
    def unsupported_prompt(_ctx: object) -> str:
        return "current system"

    async def scenario() -> None:
        with pytest.raises(ValueError, match="zero-argument system prompts"):
            await build_run_message_history(system_prompts=[unsupported_prompt], stored_history=[])

    asyncio.run(scenario())


def test_append_successful_run_history_preserves_existing_message_order() -> None:
    history_layer = PydanticAIHistoryLayer()
    stored_history = [ModelRequest(parts=[UserPromptPart(content="old user")])]
    new_messages = [ModelResponse(parts=[TextPart(content="new assistant")])]

    history_layer.replace_messages(stored_history)
    append_successful_run_history(history_layer, new_messages)

    assert history_layer.message_history == [*stored_history, *new_messages]
