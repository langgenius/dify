from core.model_runtime.entities.message_entities import (
    ImagePromptMessageContent,
    TextPromptMessageContent,
    UserPromptMessage,
)


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
