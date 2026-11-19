"""History folding is pure, locator-preserving and safe without the module."""

from pydantic_ai.messages import (
    ImageUrl,
    ModelMessagesTypeAdapter,
    ModelRequest,
    ModelResponse,
    TextPart,
    ToolCallPart,
    ToolReturnPart,
    UserPromptPart,
)

from dify_agent.layers.read_media.history import without_historical_read_media_content


def test_serialized_history_folds_only_marked_media_and_preserves_tool_pairs():
    media = ImageUrl(
        url="dify-file://tool_file/ref",
        media_type="image/png",
        vendor_metadata={
            "dify_read_media": True,
            "filename": "chart.png",
            "mime_type": "image/png",
            "locator": {"path": "./chart.png"},
        },
    )
    unmarked = ImageUrl(url="https://example.com/user.png")
    messages = [
        ModelResponse(parts=[ToolCallPart("read_media", {"path": "./chart.png"}, tool_call_id="read")]),
        ModelRequest(
            parts=[
                ToolReturnPart("read_media", "loaded", tool_call_id="read"),
                UserPromptPart(
                    content=["user text", unmarked, "Attached vision media from read_media (chart):", media]
                ),
            ]
        ),
        ModelResponse(parts=[TextPart("I saw the chart")]),
    ]
    restored = ModelMessagesTypeAdapter.validate_json(ModelMessagesTypeAdapter.dump_json(messages))
    cleaned = without_historical_read_media_content(restored)
    content = cleaned[1].parts[1].content
    assert content[0] == "user text" and isinstance(content[1], ImageUrl)
    assert "chart.png" in content[2] and 'locator={"path":"./chart.png"}' in content[2]
    assert isinstance(restored[1].parts[1].content[-1], ImageUrl)
    assert cleaned[0] == restored[0] and cleaned[2] == restored[2]
    assert cleaned[1].parts[0].tool_call_id == "read"
    assert without_historical_read_media_content(cleaned) == cleaned
