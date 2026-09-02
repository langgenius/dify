import asyncio

import pytest
from pydantic_ai import Agent
from pydantic_ai.messages import (
    INTERRUPTED_TOOL_RETURN_CONTENT,
    ModelMessage,
    ModelRequest,
    ModelResponse,
    SystemPromptPart,
    TextPart,
    ToolCallPart,
    ToolReturnPart,
    UserPromptPart,
)
from pydantic_ai.models.function import AgentInfo, FunctionModel

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
    mark_interrupted_tool_calls,
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


def test_mark_interrupted_tool_calls_marks_trailing_tool_calling_response() -> None:
    response = ModelResponse(
        parts=[
            TextPart(content="calling"),
            ToolCallPart(tool_name="search", args={"q": "a"}, tool_call_id="call-1"),
            ToolCallPart(tool_name="fetch", args={"url": "b"}, tool_call_id="call-2"),
        ]
    )
    messages: list[ModelMessage] = [ModelRequest(parts=[UserPromptPart(content="user")]), response]

    marked = mark_interrupted_tool_calls(messages)

    assert marked[0] == messages[0]
    assert len(marked) == 2
    trailing = marked[-1]
    assert isinstance(trailing, ModelResponse)
    assert trailing.state == "interrupted"
    assert trailing.parts == response.parts
    assert response.state == "complete"
    assert mark_interrupted_tool_calls(marked) == marked


def test_mark_interrupted_tool_calls_leaves_other_trailing_shapes_unchanged() -> None:
    partial_tool_return_history: list[ModelMessage] = [
        ModelRequest(parts=[UserPromptPart(content="user")]),
        ModelResponse(
            parts=[
                ToolCallPart(tool_name="search", args={}, tool_call_id="call-1"),
                ToolCallPart(tool_name="fetch", args={}, tool_call_id="call-2"),
            ]
        ),
        ModelRequest(
            parts=[ToolReturnPart(tool_name="search", content="found", tool_call_id="call-1")],
            state="interrupted",
        ),
    ]
    answered_history: list[ModelMessage] = [
        ModelRequest(parts=[UserPromptPart(content="user")]),
        ModelResponse(parts=[ToolCallPart(tool_name="search", args={}, tool_call_id="call-1")]),
        ModelRequest(parts=[ToolReturnPart(tool_name="search", content="found", tool_call_id="call-1")]),
        ModelResponse(parts=[TextPart(content="done")]),
    ]
    text_only_history: list[ModelMessage] = [
        ModelRequest(parts=[UserPromptPart(content="user")]),
        ModelResponse(parts=[TextPart(content="partial")], state="interrupted"),
    ]

    assert mark_interrupted_tool_calls(partial_tool_return_history) == partial_tool_return_history
    assert mark_interrupted_tool_calls(answered_history) == answered_history
    assert mark_interrupted_tool_calls(text_only_history) == text_only_history
    assert mark_interrupted_tool_calls([]) == []


@pytest.mark.parametrize(
    "interrupted_history",
    [
        pytest.param(
            [
                ModelRequest(parts=[UserPromptPart(content="first")]),
                ModelResponse(
                    parts=[
                        ToolCallPart(tool_name="search", args={"q": "a"}, tool_call_id="call-1"),
                        ToolCallPart(tool_name="search", args={"q": "b"}, tool_call_id="call-2"),
                    ]
                ),
            ],
            id="no-results",
        ),
        pytest.param(
            [
                ModelRequest(parts=[UserPromptPart(content="first")]),
                ModelResponse(
                    parts=[
                        ToolCallPart(tool_name="search", args={"q": "a"}, tool_call_id="call-1"),
                        ToolCallPart(tool_name="search", args={"q": "b"}, tool_call_id="call-2"),
                    ]
                ),
                ModelRequest(
                    parts=[ToolReturnPart(tool_name="search", content="found", tool_call_id="call-1")],
                    state="interrupted",
                ),
            ],
            id="partial-results",
        ),
    ],
)
def test_marked_interrupted_tool_calls_are_repaired_by_pydantic_ai_on_the_next_prompt(
    interrupted_history: list[ModelMessage],
) -> None:
    seen_requests: list[list[ModelMessage]] = []

    def respond(messages: list[ModelMessage], _info: AgentInfo) -> ModelResponse:
        seen_requests.append(list(messages))
        return ModelResponse(parts=[TextPart(content="answer")])

    agent = Agent(FunctionModel(respond))

    async def scenario() -> str:
        result = await agent.run("second", message_history=mark_interrupted_tool_calls(interrupted_history))
        return result.output

    assert asyncio.run(scenario()) == "answer"
    assert len(seen_requests) == 1
    sent_parts = [part for message in seen_requests[0] for part in message.parts]
    tool_returns = {part.tool_call_id: part for part in sent_parts if isinstance(part, ToolReturnPart)}
    assert set(tool_returns) == {"call-1", "call-2"}
    assert tool_returns["call-2"].outcome == "interrupted"
    assert tool_returns["call-2"].content == INTERRUPTED_TOOL_RETURN_CONTENT
    assert isinstance(sent_parts[-1], UserPromptPart)
    assert sent_parts[-1].content == "second"
