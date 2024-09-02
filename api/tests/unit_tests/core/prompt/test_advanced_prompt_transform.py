from unittest.mock import MagicMock

import pytest

from core.app.app_config.entities import ModelConfigEntity
from core.file.file_obj import FileExtraConfig, FileTransferMethod, FileType, FileVar
from core.memory.token_buffer_memory import TokenBufferMemory
from core.model_runtime.entities.message_entities import AssistantPromptMessage, PromptMessageRole, UserPromptMessage
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
                    f"{'Human' if prompt.role.value == 'user' else 'Assistant'}: " f"{prompt.content}"
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

    files = [
        FileVar(
            id="file1",
            tenant_id="tenant1",
            type=FileType.IMAGE,
            transfer_method=FileTransferMethod.REMOTE_URL,
            url="https://example.com/image1.jpg",
            extra_config=FileExtraConfig(
                image_config={
                    "detail": "high",
                }
            ),
        )
    ]

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

    assert len(prompt_messages) == 4
    assert prompt_messages[0].role == PromptMessageRole.SYSTEM
    assert prompt_messages[0].content == PromptTemplateParser(template=messages[0].text).format(
        {**inputs, "#context#": context}
    )
    assert isinstance(prompt_messages[3].content, list)
    assert len(prompt_messages[3].content) == 2
    assert prompt_messages[3].content[1].data == files[0].url


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
