import pytest

from core.model_runtime.entities.message_entities import (
    AssistantPromptMessage,
    AudioPromptMessageContent,
    DocumentPromptMessageContent,
    ImagePromptMessageContent,
    PromptMessageContent,
    PromptMessageContentType,
    PromptMessageFunction,
    PromptMessageRole,
    PromptMessageTool,
    SystemPromptMessage,
    TextPromptMessageContent,
    ToolPromptMessage,
    UserPromptMessage,
    VideoPromptMessageContent,
)


class TestPromptMessageRole:
    def test_value_of(self):
        assert PromptMessageRole.value_of("system") == PromptMessageRole.SYSTEM
        assert PromptMessageRole.value_of("user") == PromptMessageRole.USER
        assert PromptMessageRole.value_of("assistant") == PromptMessageRole.ASSISTANT
        assert PromptMessageRole.value_of("tool") == PromptMessageRole.TOOL

        with pytest.raises(ValueError, match="invalid prompt message type value invalid"):
            PromptMessageRole.value_of("invalid")


class TestPromptMessageEntities:
    def test_prompt_message_tool(self):
        tool = PromptMessageTool(name="test_tool", description="test desc", parameters={"foo": "bar"})
        assert tool.name == "test_tool"
        assert tool.description == "test desc"
        assert tool.parameters == {"foo": "bar"}

    def test_prompt_message_function(self):
        tool = PromptMessageTool(name="test_tool", description="test desc", parameters={"foo": "bar"})
        func = PromptMessageFunction(function=tool)
        assert func.type == "function"
        assert func.function == tool


class TestPromptMessageContent:
    def test_text_content(self):
        content = TextPromptMessageContent(data="hello")
        assert content.type == PromptMessageContentType.TEXT
        assert content.data == "hello"

    def test_image_content(self):
        content = ImagePromptMessageContent(
            format="jpg", base64_data="abc", mime_type="image/jpeg", detail=ImagePromptMessageContent.DETAIL.HIGH
        )
        assert content.type == PromptMessageContentType.IMAGE
        assert content.detail == ImagePromptMessageContent.DETAIL.HIGH
        assert content.data == "data:image/jpeg;base64,abc"

    def test_image_content_url(self):
        content = ImagePromptMessageContent(format="jpg", url="https://example.com/image.jpg", mime_type="image/jpeg")
        assert content.data == "https://example.com/image.jpg"

    def test_audio_content(self):
        content = AudioPromptMessageContent(format="mp3", base64_data="abc", mime_type="audio/mpeg")
        assert content.type == PromptMessageContentType.AUDIO
        assert content.data == "data:audio/mpeg;base64,abc"

    def test_video_content(self):
        content = VideoPromptMessageContent(format="mp4", base64_data="abc", mime_type="video/mp4")
        assert content.type == PromptMessageContentType.VIDEO
        assert content.data == "data:video/mp4;base64,abc"

    def test_document_content(self):
        content = DocumentPromptMessageContent(format="pdf", base64_data="abc", mime_type="application/pdf")
        assert content.type == PromptMessageContentType.DOCUMENT
        assert content.data == "data:application/pdf;base64,abc"


class TestPromptMessages:
    def test_user_prompt_message(self):
        msg = UserPromptMessage(content="hello")
        assert msg.role == PromptMessageRole.USER
        assert msg.content == "hello"
        assert msg.is_empty() is False
        assert msg.get_text_content() == "hello"

    def test_user_prompt_message_complex_content(self):
        content = [TextPromptMessageContent(data="hello "), TextPromptMessageContent(data="world")]
        msg = UserPromptMessage(content=content)
        assert msg.get_text_content() == "hello world"

        # Test validation from dict
        msg2 = UserPromptMessage(content=[{"type": "text", "data": "hi"}])
        assert isinstance(msg2.content[0], TextPromptMessageContent)
        assert msg2.content[0].data == "hi"

    def test_prompt_message_empty(self):
        msg = UserPromptMessage(content=None)
        assert msg.is_empty() is True
        assert msg.get_text_content() == ""

    def test_assistant_prompt_message(self):
        msg = AssistantPromptMessage(content="thinking...")
        assert msg.role == PromptMessageRole.ASSISTANT
        assert msg.is_empty() is False

        tool_call = AssistantPromptMessage.ToolCall(
            id="call_1",
            type="function",
            function=AssistantPromptMessage.ToolCall.ToolCallFunction(name="test", arguments="{}"),
        )
        msg_with_tools = AssistantPromptMessage(content=None, tool_calls=[tool_call])
        assert msg_with_tools.is_empty() is False
        assert msg_with_tools.role == PromptMessageRole.ASSISTANT

    def test_assistant_tool_call_id_transform(self):
        tool_call = AssistantPromptMessage.ToolCall(
            id=123,
            type="function",
            function=AssistantPromptMessage.ToolCall.ToolCallFunction(name="test", arguments="{}"),
        )
        assert tool_call.id == "123"

    def test_system_prompt_message(self):
        msg = SystemPromptMessage(content="you are a bot")
        assert msg.role == PromptMessageRole.SYSTEM
        assert msg.content == "you are a bot"

    def test_tool_prompt_message(self):
        # Case 1: Both content and tool_call_id are present
        msg = ToolPromptMessage(content="result", tool_call_id="call_1")
        assert msg.role == PromptMessageRole.TOOL
        assert msg.tool_call_id == "call_1"
        assert msg.is_empty() is False

        # Case 2: Content is present, but tool_call_id is empty
        msg_content_only = ToolPromptMessage(content="result", tool_call_id="")
        assert msg_content_only.is_empty() is False

        # Case 3: Content is None, but tool_call_id is present
        msg_id_only = ToolPromptMessage(content=None, tool_call_id="call_1")
        assert msg_id_only.is_empty() is False

        # Case 4: Both content and tool_call_id are empty
        msg_empty = ToolPromptMessage(content=None, tool_call_id="")
        assert msg_empty.is_empty() is True

    def test_prompt_message_validation_errors(self):
        with pytest.raises(KeyError):
            # Invalid content type in list
            UserPromptMessage(content=[{"type": "invalid", "data": "foo"}])

        with pytest.raises(ValueError, match="invalid prompt message"):
            # Not a dict or PromptMessageContent
            UserPromptMessage(content=[123])

    def test_prompt_message_serialization(self):
        # Case: content is None
        assert UserPromptMessage(content=None).serialize_content(None) is None

        # Case: content is str
        assert UserPromptMessage(content="hello").serialize_content("hello") == "hello"

        # Case: content is list of dict
        content_list = [{"type": "text", "data": "hi"}]
        msg = UserPromptMessage(content=content_list)
        assert msg.serialize_content(msg.content) == [{"type": PromptMessageContentType.TEXT, "data": "hi"}]

        # Case: content is Sequence but not list (e.g. tuple)
        # To hit line 204, we can call serialize_content manually or
        # try to pass a type that pydantic doesn't convert to list in its internal state.
        # Actually, let's just call it manually on the instance.
        msg = UserPromptMessage(content="test")
        content_tuple = (TextPromptMessageContent(data="hi"),)
        assert msg.serialize_content(content_tuple) == content_tuple

    def test_prompt_message_mixed_content_validation(self):
        # Test branch: isinstance(prompt, PromptMessageContent)
        # but not (TextPromptMessageContent | MultiModalPromptMessageContent)
        # Line 187: prompt = CONTENT_TYPE_MAPPING[prompt.type].model_validate(prompt.model_dump())

        # We need a PromptMessageContent that is NOT Text or MultiModal.
        # But PromptMessageContentUnionTypes discriminator handles this usually.
        # We can bypass high-level validation by passing the object directly in a list.

        class MockContent(PromptMessageContent):
            type: PromptMessageContentType = PromptMessageContentType.TEXT
            data: str

        mock_item = MockContent(data="test")
        msg = UserPromptMessage(content=[mock_item])
        # It should hit line 187 and convert to TextPromptMessageContent
        assert isinstance(msg.content[0], TextPromptMessageContent)
        assert msg.content[0].data == "test"

    def test_prompt_message_get_text_content_branches(self):
        # content is None
        msg_none = UserPromptMessage(content=None)
        assert msg_none.get_text_content() == ""

        # content is list but no text content
        image = ImagePromptMessageContent(format="jpg", base64_data="abc", mime_type="image/jpeg")
        msg_image = UserPromptMessage(content=[image])
        assert msg_image.get_text_content() == ""

        # content is list with mixed
        text = TextPromptMessageContent(data="hello")
        msg_mixed = UserPromptMessage(content=[text, image])
        assert msg_mixed.get_text_content() == "hello"
