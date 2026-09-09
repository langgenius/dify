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
    get_history_layer,
    replace_run_history,
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


def test_replace_run_history_persists_full_history_without_instructions() -> None:
    history_layer = PydanticAIHistoryLayer()
    history_layer.replace_messages([ModelRequest(parts=[UserPromptPart(content="stale")])])
    messages = [
        ModelRequest(
            parts=[SystemPromptPart(content="Summary of previous conversation:\n\nsummary")],
            instructions="current instructions",
        ),
        ModelRequest(parts=[UserPromptPart(content="new user")]),
        ModelResponse(parts=[TextPart(content="new assistant")]),
    ]

    replace_run_history(history_layer, messages)

    persisted = history_layer.message_history
    assert len(persisted) == 3
    persisted_request = persisted[0]
    assert isinstance(persisted_request, ModelRequest)
    assert persisted_request.instructions is None
    assert persisted_request.parts == messages[0].parts
    assert persisted[1:] == messages[1:]
    source_request = messages[0]
    assert isinstance(source_request, ModelRequest)
    assert source_request.instructions == "current instructions"
