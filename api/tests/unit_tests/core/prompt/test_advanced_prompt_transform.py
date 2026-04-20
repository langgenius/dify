from typing import cast
from unittest.mock import MagicMock, patch

import pytest
from graphon.file import File, FileTransferMethod, FileType
from graphon.model_runtime.entities.message_entities import (
    AssistantPromptMessage,
    ImagePromptMessageContent,
    PromptMessageRole,
    SystemPromptMessage,
    TextPromptMessageContent,
    UserPromptMessage,
)

from configs import dify_config
from core.app.app_config.entities import ModelConfigEntity
from core.memory.token_buffer_memory import TokenBufferMemory
from core.prompt.advanced_prompt_transform import AdvancedPromptTransform
from core.prompt.entities.advanced_prompt_entities import ChatModelMessage, CompletionModelPromptTemplate, MemoryConfig
from core.prompt.utils.prompt_template_parser import PromptTemplateParser
from models.model import Conversation


def test__get_completion_model_prompt_messages():
    model_config_mock = MagicMock(spec=ModelConfigEntity)
    model_config_mock.provider = "openai"
    model_config_mock.model = "gpt-3.5-turbo-instruct"

    prompt_template = "Context:\n{{#context#}}\n\nHistories:\n{{#histories#}}\n\nyou are {{name}}."
    prompt_template_config = CompletionModelPromptTemplate(text=prompt_template)

    memory_config = MemoryConfig(
        role_prefix=MemoryConfig.RolePrefix(user="Human", assistant="Assistant"),
        window=MemoryConfig.WindowConfig(enabled=False),
    )

    inputs = {"name": "John"}
    files = []
    context = "I am superman."

    memory = TokenBufferMemory(conversation=Conversation(), model_instance=model_config_mock)

    history_prompt_messages = [UserPromptMessage(content="Hi"), AssistantPromptMessage(content="Hello")]
    memory.get_history_prompt_messages = MagicMock(return_value=history_prompt_messages)

    prompt_transform = AdvancedPromptTransform()
    prompt_transform._calculate_rest_token = MagicMock(return_value=2000)
    prompt_messages = prompt_transform._get_completion_model_prompt_messages(
        prompt_template=prompt_template_config,
        inputs=inputs,
        query=None,
        files=files,
        context=context,
        memory_config=memory_config,
        memory=memory,
        model_config=model_config_mock,
    )

    assert len(prompt_messages) == 1
    assert prompt_messages[0].content == PromptTemplateParser(template=prompt_template).format(
        {
            "#context#": context,
            "#histories#": "\n".join(
                [
                    f"{'Human' if prompt.role.value == 'user' else 'Assistant'}: {prompt.content}"
                    for prompt in history_prompt_messages
                ]
            ),
            **inputs,
        }
    )


def test__get_chat_model_prompt_messages(get_chat_model_args):
    model_config_mock, memory_config, messages, inputs, context = get_chat_model_args

    files = []
    query = "Hi2."

    memory = TokenBufferMemory(conversation=Conversation(), model_instance=model_config_mock)

    history_prompt_messages = [UserPromptMessage(content="Hi1."), AssistantPromptMessage(content="Hello1!")]
    memory.get_history_prompt_messages = MagicMock(return_value=history_prompt_messages)

    prompt_transform = AdvancedPromptTransform()
    prompt_transform._calculate_rest_token = MagicMock(return_value=2000)
    prompt_messages = prompt_transform._get_chat_model_prompt_messages(
        prompt_template=messages,
        inputs=inputs,
        query=query,
        files=files,
        context=context,
        memory_config=memory_config,
        memory=memory,
        model_config=model_config_mock,
    )

    assert len(prompt_messages) == 6
    assert prompt_messages[0].role == PromptMessageRole.SYSTEM
    assert prompt_messages[0].content == PromptTemplateParser(template=messages[0].text).format(
        {**inputs, "#context#": context}
    )
    assert prompt_messages[5].content == query


def test__get_chat_model_prompt_messages_no_memory(get_chat_model_args):
    model_config_mock, _, messages, inputs, context = get_chat_model_args

    files = []

    prompt_transform = AdvancedPromptTransform()
    prompt_transform._calculate_rest_token = MagicMock(return_value=2000)
    prompt_messages = prompt_transform._get_chat_model_prompt_messages(
        prompt_template=messages,
        inputs=inputs,
        query=None,
        files=files,
        context=context,
        memory_config=None,
        memory=None,
        model_config=model_config_mock,
    )

    assert len(prompt_messages) == 3
    assert prompt_messages[0].role == PromptMessageRole.SYSTEM
    assert prompt_messages[0].content == PromptTemplateParser(template=messages[0].text).format(
        {**inputs, "#context#": context}
    )


def test__get_chat_model_prompt_messages_with_files_no_memory(get_chat_model_args):
    model_config_mock, _, messages, inputs, context = get_chat_model_args
    dify_config.MULTIMODAL_SEND_FORMAT = "url"

    files = [
        File(
            id="file1",
            tenant_id="tenant1",
            type=FileType.IMAGE,
            transfer_method=FileTransferMethod.REMOTE_URL,
            remote_url="https://example.com/image1.jpg",
            storage_key="",
        )
    ]

    prompt_transform = AdvancedPromptTransform()
    prompt_transform._calculate_rest_token = MagicMock(return_value=2000)
    with patch("graphon.file.file_manager.to_prompt_message_content", autospec=True) as mock_get_encoded_string:
        mock_get_encoded_string.return_value = ImagePromptMessageContent(
            url=str(files[0].remote_url), format="jpg", mime_type="image/jpg"
        )
        prompt_messages = prompt_transform._get_chat_model_prompt_messages(
            prompt_template=messages,
            inputs=inputs,
            query=None,
            files=files,
            context=context,
            memory_config=None,
            memory=None,
            model_config=model_config_mock,
        )

    assert len(prompt_messages) == 4
    assert prompt_messages[0].role == PromptMessageRole.SYSTEM
    assert prompt_messages[0].content == PromptTemplateParser(template=messages[0].text).format(
        {**inputs, "#context#": context}
    )
    assert isinstance(prompt_messages[3].content, list)
    assert len(prompt_messages[3].content) == 2
    assert prompt_messages[3].content[0].data == files[0].remote_url


@pytest.fixture
def get_chat_model_args():
    model_config_mock = MagicMock(spec=ModelConfigEntity)
    model_config_mock.provider = "openai"
    model_config_mock.model = "gpt-4"

    memory_config = MemoryConfig(window=MemoryConfig.WindowConfig(enabled=False))

    prompt_messages = [
        ChatModelMessage(
            text="You are a helpful assistant named {{name}}.\n\nContext:\n{{#context#}}", role=PromptMessageRole.SYSTEM
        ),
        ChatModelMessage(text="Hi.", role=PromptMessageRole.USER),
        ChatModelMessage(text="Hello!", role=PromptMessageRole.ASSISTANT),
    ]

    inputs = {"name": "John"}

    context = "I am superman."

    return model_config_mock, memory_config, prompt_messages, inputs, context


def test_get_prompt_dispatches_completion_and_chat_and_invalid():
    transform = AdvancedPromptTransform()
    model_config = MagicMock(spec=ModelConfigEntity)
    completion_template = CompletionModelPromptTemplate(text="Hello {{name}}", edition_type="basic")
    chat_template = [ChatModelMessage(text="Hello {{name}}", role=PromptMessageRole.USER, edition_type="basic")]

    transform._get_completion_model_prompt_messages = MagicMock(return_value=[UserPromptMessage(content="c")])
    transform._get_chat_model_prompt_messages = MagicMock(return_value=[UserPromptMessage(content="h")])

    completion_result = transform.get_prompt(
        prompt_template=completion_template,
        inputs={"name": "john"},
        query="q",
        files=[],
        context=None,
        memory_config=None,
        memory=None,
        model_config=model_config,
    )
    assert completion_result[0].content == "c"

    chat_result = transform.get_prompt(
        prompt_template=chat_template,
        inputs={"name": "john"},
        query="q",
        files=[],
        context=None,
        memory_config=None,
        memory=None,
        model_config=model_config,
    )
    assert chat_result[0].content == "h"

    invalid_result = transform.get_prompt(
        prompt_template=cast(list, ["not-chat-model-message"]),
        inputs={"name": "john"},
        query="q",
        files=[],
        context=None,
        memory_config=None,
        memory=None,
        model_config=model_config,
    )
    assert invalid_result == []


def test_completion_prompt_jinja2_with_files():
    model_config_mock = MagicMock(spec=ModelConfigEntity)
    transform = AdvancedPromptTransform()
    completion_template = CompletionModelPromptTemplate(text="Hi {{name}}", edition_type="jinja2")

    file = File(
        id="file1",
        tenant_id="tenant1",
        type=FileType.IMAGE,
        transfer_method=FileTransferMethod.REMOTE_URL,
        remote_url="https://example.com/image.jpg",
        storage_key="",
    )

    with (
        patch("core.prompt.advanced_prompt_transform.Jinja2Formatter.format", return_value="Hi John"),
        patch("core.prompt.advanced_prompt_transform.file_manager.to_prompt_message_content") as to_content,
    ):
        to_content.return_value = ImagePromptMessageContent(
            url="https://example.com/image.jpg", format="jpg", mime_type="image/jpg"
        )
        messages = transform._get_completion_model_prompt_messages(
            prompt_template=completion_template,
            inputs={"name": "John"},
            query="",
            files=[file],
            context=None,
            memory_config=None,
            memory=None,
            model_config=model_config_mock,
        )

    assert len(messages) == 1
    assert isinstance(messages[0].content, list)
    assert messages[0].content[0].data == "https://example.com/image.jpg"
    assert isinstance(messages[0].content[1], TextPromptMessageContent)
    assert messages[0].content[1].data == "Hi John"


def test_completion_prompt_basic_sets_query_variable():
    model_config_mock = MagicMock(spec=ModelConfigEntity)
    transform = AdvancedPromptTransform()
    template = CompletionModelPromptTemplate(text="Q={{#query#}}", edition_type="basic")

    messages = transform._get_completion_model_prompt_messages(
        prompt_template=template,
        inputs={},
        query="what?",
        files=[],
        context=None,
        memory_config=None,
        memory=None,
        model_config=model_config_mock,
    )

    assert messages[0].content == "Q=what?"


def test_chat_prompt_with_variable_template_and_context():
    transform = AdvancedPromptTransform(with_variable_tmpl=True)
    model_config_mock = MagicMock(spec=ModelConfigEntity)
    prompt_template = [ChatModelMessage(text="sys={{#node.name#}} ctx={{#context#}}", role=PromptMessageRole.SYSTEM)]

    messages = transform._get_chat_model_prompt_messages(
        prompt_template=prompt_template,
        inputs={"#node.name#": "john"},
        query=None,
        files=[],
        context="context-text",
        memory_config=None,
        memory=None,
        model_config=model_config_mock,
    )

    assert len(messages) == 1
    assert isinstance(messages[0], SystemPromptMessage)
    assert messages[0].content == "sys=john ctx=context-text"


def test_chat_prompt_jinja2_branch_and_invalid_edition():
    transform = AdvancedPromptTransform()
    model_config_mock = MagicMock(spec=ModelConfigEntity)
    prompt_template = [ChatModelMessage(text="Hello {{name}}", role=PromptMessageRole.USER, edition_type="jinja2")]

    with patch("core.prompt.advanced_prompt_transform.Jinja2Formatter.format", return_value="Hello John"):
        messages = transform._get_chat_model_prompt_messages(
            prompt_template=prompt_template,
            inputs={"name": "John"},
            query=None,
            files=[],
            context=None,
            memory_config=None,
            memory=None,
            model_config=model_config_mock,
        )
    assert messages[0].content == "Hello John"

    bad_prompt_template = [ChatModelMessage.model_construct(text="bad", role=PromptMessageRole.USER, edition_type="x")]
    with pytest.raises(ValueError, match="Invalid edition type"):
        transform._get_chat_model_prompt_messages(
            prompt_template=bad_prompt_template,
            inputs={},
            query=None,
            files=[],
            context=None,
            memory_config=None,
            memory=None,
            model_config=model_config_mock,
        )


def test_chat_prompt_query_template_and_query_only_branch():
    transform = AdvancedPromptTransform()
    model_config_mock = MagicMock(spec=ModelConfigEntity)
    memory_config = MemoryConfig(
        window=MemoryConfig.WindowConfig(enabled=False),
        query_prompt_template="query={{#sys.query#}} ctx={{#context#}}",
    )
    prompt_template = [ChatModelMessage(text="sys", role=PromptMessageRole.SYSTEM)]

    messages = transform._get_chat_model_prompt_messages(
        prompt_template=prompt_template,
        inputs={},
        query="what",
        files=[],
        context="ctx",
        memory_config=memory_config,
        memory=None,
        model_config=model_config_mock,
    )
    assert messages[-1].content == "query={{#sys.query#}} ctx=ctx"


def test_chat_prompt_memory_with_files_and_query():
    transform = AdvancedPromptTransform()
    model_config_mock = MagicMock(spec=ModelConfigEntity)
    memory_config = MemoryConfig(window=MemoryConfig.WindowConfig(enabled=False))
    memory = MagicMock(spec=TokenBufferMemory)
    prompt_template = [ChatModelMessage(text="sys", role=PromptMessageRole.SYSTEM)]
    file = File(
        id="file1",
        tenant_id="tenant1",
        type=FileType.IMAGE,
        transfer_method=FileTransferMethod.REMOTE_URL,
        remote_url="https://example.com/image.jpg",
        storage_key="",
    )

    transform._append_chat_histories = MagicMock(
        side_effect=lambda memory, memory_config, prompt_messages, **kwargs: prompt_messages
    )
    with patch("core.prompt.advanced_prompt_transform.file_manager.to_prompt_message_content") as to_content:
        to_content.return_value = ImagePromptMessageContent(
            url="https://example.com/image.jpg", format="jpg", mime_type="image/jpg"
        )
        messages = transform._get_chat_model_prompt_messages(
            prompt_template=prompt_template,
            inputs={},
            query="q",
            files=[file],
            context=None,
            memory_config=memory_config,
            memory=memory,
            model_config=model_config_mock,
        )

    assert isinstance(messages[-1].content, list)
    assert messages[-1].content[1].data == "q"


def test_chat_prompt_files_without_query_updates_last_user_or_appends_new():
    transform = AdvancedPromptTransform()
    model_config_mock = MagicMock(spec=ModelConfigEntity)
    file = File(
        id="file1",
        tenant_id="tenant1",
        type=FileType.IMAGE,
        transfer_method=FileTransferMethod.REMOTE_URL,
        remote_url="https://example.com/image.jpg",
        storage_key="",
    )

    prompt_with_last_user = [ChatModelMessage(text="u", role=PromptMessageRole.USER)]
    with patch("core.prompt.advanced_prompt_transform.file_manager.to_prompt_message_content") as to_content:
        to_content.return_value = ImagePromptMessageContent(
            url="https://example.com/image.jpg", format="jpg", mime_type="image/jpg"
        )
        messages = transform._get_chat_model_prompt_messages(
            prompt_template=prompt_with_last_user,
            inputs={},
            query=None,
            files=[file],
            context=None,
            memory_config=None,
            memory=None,
            model_config=model_config_mock,
        )
    assert isinstance(messages[-1].content, list)
    assert messages[-1].content[1].data == "u"

    prompt_without_last_user = [ChatModelMessage(text="s", role=PromptMessageRole.SYSTEM)]
    with patch("core.prompt.advanced_prompt_transform.file_manager.to_prompt_message_content") as to_content:
        to_content.return_value = ImagePromptMessageContent(
            url="https://example.com/image.jpg", format="jpg", mime_type="image/jpg"
        )
        messages = transform._get_chat_model_prompt_messages(
            prompt_template=prompt_without_last_user,
            inputs={},
            query=None,
            files=[file],
            context=None,
            memory_config=None,
            memory=None,
            model_config=model_config_mock,
        )
    assert isinstance(messages[-1], UserPromptMessage)
    assert isinstance(messages[-1].content, list)
    assert messages[-1].content[1].data == ""


def test_chat_prompt_files_with_query_branch():
    transform = AdvancedPromptTransform()
    model_config_mock = MagicMock(spec=ModelConfigEntity)
    file = File(
        id="file1",
        tenant_id="tenant1",
        type=FileType.IMAGE,
        transfer_method=FileTransferMethod.REMOTE_URL,
        remote_url="https://example.com/image.jpg",
        storage_key="",
    )

    with patch("core.prompt.advanced_prompt_transform.file_manager.to_prompt_message_content") as to_content:
        to_content.return_value = ImagePromptMessageContent(
            url="https://example.com/image.jpg", format="jpg", mime_type="image/jpg"
        )
        messages = transform._get_chat_model_prompt_messages(
            prompt_template=[],
            inputs={},
            query="query-text",
            files=[file],
            context=None,
            memory_config=None,
            memory=None,
            model_config=model_config_mock,
        )

    assert isinstance(messages[-1].content, list)
    assert messages[-1].content[1].data == "query-text"


def test_set_context_query_histories_variable_helpers():
    transform = AdvancedPromptTransform()
    parser_context = PromptTemplateParser(template="{{#context#}}")
    parser_query = PromptTemplateParser(template="{{#query#}}")
    parser_hist = PromptTemplateParser(template="{{#histories#}}")
    model_config_mock = MagicMock(spec=ModelConfigEntity)
    memory_config = MemoryConfig(
        role_prefix=MemoryConfig.RolePrefix(user="Human", assistant="Assistant"),
        window=MemoryConfig.WindowConfig(enabled=False),
    )

    assert transform._set_context_variable(None, parser_context, {})["#context#"] == ""
    assert transform._set_query_variable("", parser_query, {})["#query#"] == ""
    assert transform._set_query_variable("x", parser_query, {})["#query#"] == "x"
    assert (
        transform._set_histories_variable(
            memory=None,  # type: ignore[arg-type]
            memory_config=memory_config,
            raw_prompt="{{#histories#}}",
            role_prefix=memory_config.role_prefix,  # type: ignore[arg-type]
            parser=parser_hist,
            prompt_inputs={},
            model_config=model_config_mock,
        )["#histories#"]
        == ""
    )
