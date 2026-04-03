from graphon.model_runtime.entities.message_entities import (
    AssistantPromptMessage,
    AudioPromptMessageContent,
    ImagePromptMessageContent,
    TextPromptMessageContent,
    ToolPromptMessage,
    UserPromptMessage,
)

from core.prompt.simple_prompt_transform import ModelMode
from core.prompt.utils.prompt_message_util import PromptMessageUtil


def test_build_prompt_message_with_prompt_message_contents():
    prompt = UserPromptMessage(content=[TextPromptMessageContent(data="Hello, World!")])
    assert isinstance(prompt.content, list)
    assert isinstance(prompt.content[0], TextPromptMessageContent)
    assert prompt.content[0].data == "Hello, World!"


def test_dump_prompt_message():
    example_url = "https://example.com/image.jpg"
    prompt = UserPromptMessage(
        content=[
            ImagePromptMessageContent(
                url=example_url,
                format="jpeg",
                mime_type="image/jpeg",
            )
        ]
    )
    data = prompt.model_dump()
    assert data["content"][0].get("url") == example_url


def test_prompt_messages_to_prompt_for_saving_chat_mode():
    chat_messages = [
        UserPromptMessage(
            content=[
                TextPromptMessageContent(data="hello "),
                ImagePromptMessageContent(
                    url="https://example.com/image1.jpg",
                    format="jpg",
                    mime_type="image/jpeg",
                    detail=ImagePromptMessageContent.DETAIL.HIGH,
                ),
                AudioPromptMessageContent(
                    url="https://example.com/audio1.mp3",
                    format="mp3",
                    mime_type="audio/mpeg",
                ),
                TextPromptMessageContent(data="world"),
            ]
        ),
        AssistantPromptMessage(
            content="assistant-text",
            tool_calls=[
                {
                    "id": "tool-1",
                    "type": "function",
                    "function": {"name": "search", "arguments": '{"q":"python"}'},
                }
            ],
        ),
        ToolPromptMessage(content="tool-output", name="search", tool_call_id="tool-1"),
        UserPromptMessage.model_construct(role="unknown", content="skip"),  # type: ignore[arg-type]
    ]

    prompts = PromptMessageUtil.prompt_messages_to_prompt_for_saving(ModelMode.CHAT, chat_messages)

    assert len(prompts) == 3
    assert prompts[0]["role"] == "user"
    assert prompts[0]["text"] == "hello world"
    assert prompts[0]["files"][0]["type"] == "image"
    assert prompts[0]["files"][1]["type"] == "audio"

    assert prompts[1]["role"] == "assistant"
    assert prompts[1]["text"] == "assistant-text"
    assert prompts[1]["tool_calls"][0]["function"]["name"] == "search"
    assert prompts[2]["role"] == "tool"


def test_prompt_messages_to_prompt_for_saving_completion_mode_with_and_without_files():
    completion_message_with_files = UserPromptMessage(
        content=[
            TextPromptMessageContent(data="first "),
            TextPromptMessageContent(data="second"),
            ImagePromptMessageContent(
                url="https://example.com/image2.jpg",
                format="jpg",
                mime_type="image/jpeg",
                detail=ImagePromptMessageContent.DETAIL.LOW,
            ),
        ]
    )
    prompts = PromptMessageUtil.prompt_messages_to_prompt_for_saving(
        ModelMode.COMPLETION, [completion_message_with_files]
    )
    assert prompts == [
        {
            "role": "user",
            "text": "first second",
            "files": prompts[0]["files"],
        }
    ]
    assert prompts[0]["files"][0]["type"] == "image"

    completion_message_text_only = UserPromptMessage(content="plain text")
    prompts = PromptMessageUtil.prompt_messages_to_prompt_for_saving(
        ModelMode.COMPLETION, [completion_message_text_only]
    )
    assert prompts == [{"role": "user", "text": "plain text"}]
