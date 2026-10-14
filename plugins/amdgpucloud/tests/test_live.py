import json
import os

import pytest
from dify_plugin.entities.model.llm import LLMResultChunk
from dify_plugin.entities.model.message import (
    AssistantPromptMessage,
    ImagePromptMessageContent,
    PromptMessage,
    PromptMessageTool,
    TextPromptMessageContent,
    ToolPromptMessage,
    UserPromptMessage,
)

from models._catalog import discover_models
from models.llm.llm import AMDGPUCloudLargeLanguageModel

API_KEY = os.getenv("RADEON_API_KEY", "").strip()
LIVE_ENABLED = os.getenv("RUN_RADEON_LIVE") == "1"

pytestmark = [
    pytest.mark.live,
    pytest.mark.skipif(
        not (API_KEY and LIVE_ENABLED),
        reason="set RUN_RADEON_LIVE=1 and RADEON_API_KEY",
    ),
]


class _Credentials(dict[str, str]):
    def __repr__(self) -> str:
        return "AMDGPUCloud live-test credentials"

    __str__ = __repr__


llm = AMDGPUCloudLargeLanguageModel(model_schemas=[])


@pytest.fixture(scope="module")
def catalog():
    return discover_models({"api_key": API_KEY}, force_refresh=True)


def _invoke(
    messages: list[PromptMessage],
    *,
    model: str,
    parameters: dict,
    tools: list[PromptMessageTool] | None = None,
    stream: bool,
) -> list[LLMResultChunk]:
    return list(
        llm.invoke(
            model=model,
            credentials=_Credentials(api_key=API_KEY),
            prompt_messages=messages,
            model_parameters=parameters,
            tools=tools,
            stream=stream,
            user="amdgpucloud-dify-live-test",
        )
    )


def _text(chunks: list[LLMResultChunk]) -> str:
    return "".join(
        chunk.delta.message.content
        for chunk in chunks
        if isinstance(chunk.delta.message.content, str)
    )


def _terminal(chunks: list[LLMResultChunk]):
    assert chunks
    terminal = chunks[-1].delta
    assert terminal.usage is not None
    assert terminal.usage.total_tokens > 0
    return terminal


def test_current_remote_models_accept_a_minimal_request(catalog) -> None:
    assert catalog
    for schema in catalog[:20]:
        chunks = _invoke(
            [UserPromptMessage(content="Reply only with OK.")],
            model=schema["model"], parameters={"max_tokens": 32}, stream=False,
        )
        assert _text(chunks).strip()
        _terminal(chunks)


def test_streaming_reasoning_closes_cleanly(catalog) -> None:
    chunks = _invoke(
        [UserPromptMessage(content="Calculate 17 * 19, then reply with 323.")],
        model=catalog[0]["model"],
        parameters={"max_tokens": 256},
        stream=True,
    )

    text = _text(chunks)
    assert "323" in text
    assert text.count("<think>") == text.count("</think>")
    _terminal(chunks)


def test_remote_vision_model_reads_inline_image(catalog) -> None:
    candidates = [schema for schema in catalog if "vision" in schema["features"]]
    if not candidates:
        pytest.skip("Current remote catalog has no image model")
    model = candidates[0]["model"]
    image = ImagePromptMessageContent(
        format="png",
        mime_type="image/png",
        base64_data=(
            "iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAIAAAD8GO2jAAAAKElEQVR4nO3NsQ0A"
            "AAzCMP5/un0CNkuZ41wybXsHAAAAAAAAAAAAxR4yw/wuPL6QkAAAAABJRU5ErkJggg=="
        ),
    )
    chunks = _invoke(
        [
            UserPromptMessage(
                content=[
                    TextPromptMessageContent(
                        data="Name the color of this image in one English word."
                    ),
                    image,
                ]
            )
        ],
        model=model,
        parameters={"max_tokens": 32},
        stream=False,
    )

    assert "red" in _text(chunks).lower()
    _terminal(chunks)


def test_json_object_output(catalog) -> None:
    chunks = _invoke(
        [UserPromptMessage(content='Return only this JSON object: {"answer":"OK"}')],
        model=catalog[0]["model"],
        parameters={"max_tokens": 64, "response_format": "json_object"},
        stream=False,
    )

    assert json.loads(_text(chunks))["answer"] == "OK"
    _terminal(chunks)


def test_tool_call_and_result_round_trip(catalog) -> None:
    tool = PromptMessageTool(
        name="get_live_marker",
        description="Return the marker required to answer the user.",
        parameters={"type": "object", "properties": {}},
    )
    prompt = UserPromptMessage(
        content="Call get_live_marker exactly once, then answer with its result."
    )
    first = _invoke(
        [prompt],
        model=catalog[0]["model"],
        parameters={"max_tokens": 256},
        tools=[tool],
        stream=False,
    )
    assistant = _terminal(first).message
    assert isinstance(assistant, AssistantPromptMessage)
    assert assistant.tool_calls

    second = _invoke(
        [
            prompt,
            assistant,
            *[
                ToolPromptMessage(
                    content='{"marker":"DIFY_RADEON_OK"}',
                    tool_call_id=call.id,
                )
                for call in assistant.tool_calls
            ],
        ],
        model=catalog[0]["model"],
        parameters={"max_tokens": 256},
        tools=[tool],
        stream=False,
    )

    assert "DIFY_RADEON_OK" in _text(second)
    _terminal(second)