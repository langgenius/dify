import asyncio

from pydantic_ai.messages import ModelMessage, ModelRequest, ModelResponse, TextPart, UserPromptPart

from agenton.compositor import Compositor, LayerNode
from agenton.layers import LifecycleState
from agenton_collections.layers.pydantic_ai import PydanticAIHistoryLayer, PydanticAIHistoryRuntimeState


def test_pydantic_ai_history_layer_starts_empty_and_contributes_no_prompts_or_tools() -> None:
    layer = PydanticAIHistoryLayer()

    assert layer.message_history == []
    assert list(layer.prefix_prompts) == []
    assert list(layer.suffix_prompts) == []
    assert list(layer.user_prompts) == []
    assert list(layer.tools) == []


def test_pydantic_ai_history_layer_replace_messages_saves_validated_copy() -> None:
    layer = PydanticAIHistoryLayer()
    messages = _sample_messages()

    layer.replace_messages(messages)
    borrowed_messages = layer.message_history

    assert borrowed_messages == messages
    assert borrowed_messages is not messages

    messages.append(ModelResponse(parts=[TextPart(content="later")]))
    assert layer.message_history != messages


def test_pydantic_ai_history_layer_append_messages_preserves_order_and_internal_state() -> None:
    layer = PydanticAIHistoryLayer()
    request, response = _sample_messages()

    layer.replace_messages([request])
    layer.append_messages((response,))

    borrowed_messages = layer.message_history
    borrowed_messages.clear()

    assert layer.message_history == [request, response]


def test_pydantic_ai_history_layer_clear_removes_stored_messages() -> None:
    layer = PydanticAIHistoryLayer()

    layer.replace_messages(_sample_messages())
    layer.clear()

    assert layer.message_history == []
    assert layer.runtime_state.messages == []


def test_pydantic_ai_history_runtime_state_round_trips_through_json_dump() -> None:
    messages = _sample_messages()
    runtime_state = PydanticAIHistoryRuntimeState(messages=messages)

    dumped_state = runtime_state.model_dump(mode="json")
    restored_state = PydanticAIHistoryRuntimeState.model_validate(dumped_state)

    assert restored_state.messages == messages
    assert isinstance(restored_state.messages[0], ModelRequest)
    assert isinstance(restored_state.messages[1], ModelResponse)


def test_pydantic_ai_history_layer_messages_round_trip_through_session_snapshot() -> None:
    compositor = Compositor([LayerNode("history", PydanticAIHistoryLayer)])
    messages = _sample_messages()

    async def scenario() -> None:
        async with compositor.enter() as first_run:
            history_layer = first_run.get_layer("history", PydanticAIHistoryLayer)
            history_layer.replace_messages(messages)
            first_run.suspend_on_exit()

        assert first_run.session_snapshot is not None
        assert first_run.session_snapshot.layers[0].lifecycle_state is LifecycleState.SUSPENDED

        async with compositor.enter(session_snapshot=first_run.session_snapshot) as resumed_run:
            history_layer = resumed_run.get_layer("history", PydanticAIHistoryLayer)

            assert history_layer.message_history == messages
            assert isinstance(history_layer.runtime_state.messages[0], ModelRequest)
            assert isinstance(history_layer.runtime_state.messages[1], ModelResponse)

    asyncio.run(scenario())


def _sample_messages() -> list[ModelMessage]:
    return [
        ModelRequest(parts=[UserPromptPart(content="Hello")]),
        ModelResponse(parts=[TextPart(content="Hi there")]),
    ]
