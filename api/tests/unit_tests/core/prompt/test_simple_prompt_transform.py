from types import SimpleNamespace
from unittest.mock import MagicMock, patch

import pytest
from graphon.model_runtime.entities.message_entities import (
    AssistantPromptMessage,
    ImagePromptMessageContent,
    TextPromptMessageContent,
    UserPromptMessage,
)

from core.app.entities.app_invoke_entities import ModelConfigWithCredentialsEntity
from core.memory.token_buffer_memory import TokenBufferMemory
from core.prompt.prompt_templates.advanced_prompt_templates import (
    BAICHUAN_CHAT_APP_CHAT_PROMPT_CONFIG,
    BAICHUAN_CHAT_APP_COMPLETION_PROMPT_CONFIG,
    BAICHUAN_COMPLETION_APP_CHAT_PROMPT_CONFIG,
    BAICHUAN_COMPLETION_APP_COMPLETION_PROMPT_CONFIG,
    BAICHUAN_CONTEXT,
    CHAT_APP_CHAT_PROMPT_CONFIG,
    CHAT_APP_COMPLETION_PROMPT_CONFIG,
    COMPLETION_APP_CHAT_PROMPT_CONFIG,
    COMPLETION_APP_COMPLETION_PROMPT_CONFIG,
    CONTEXT,
)
from core.prompt.simple_prompt_transform import SimplePromptTransform
from models.model import AppMode, Conversation


def test_get_common_chat_app_prompt_template_with_pcqm():
    prompt_transform = SimplePromptTransform()
    pre_prompt = "You are a helpful assistant."
    prompt_template = prompt_transform.get_prompt_template(
        app_mode=AppMode.CHAT,
        provider="openai",
        model="gpt-4",
        pre_prompt=pre_prompt,
        has_context=True,
        query_in_prompt=True,
        with_memory_prompt=True,
    )
    prompt_rules = prompt_template["prompt_rules"]
    assert prompt_template["prompt_template"].template == (
        prompt_rules["context_prompt"]
        + pre_prompt
        + "\n"
        + prompt_rules["histories_prompt"]
        + prompt_rules["query_prompt"]
    )
    assert prompt_template["special_variable_keys"] == ["#context#", "#histories#", "#query#"]


def test_get_baichuan_chat_app_prompt_template_with_pcqm():
    prompt_transform = SimplePromptTransform()
    pre_prompt = "You are a helpful assistant."
    prompt_template = prompt_transform.get_prompt_template(
        app_mode=AppMode.CHAT,
        provider="baichuan",
        model="Baichuan2-53B",
        pre_prompt=pre_prompt,
        has_context=True,
        query_in_prompt=True,
        with_memory_prompt=True,
    )
    prompt_rules = prompt_template["prompt_rules"]
    assert prompt_template["prompt_template"].template == (
        prompt_rules["context_prompt"]
        + pre_prompt
        + "\n"
        + prompt_rules["histories_prompt"]
        + prompt_rules["query_prompt"]
    )
    assert prompt_template["special_variable_keys"] == ["#context#", "#histories#", "#query#"]


def test_get_common_completion_app_prompt_template_with_pcq():
    prompt_transform = SimplePromptTransform()
    pre_prompt = "You are a helpful assistant."
    prompt_template = prompt_transform.get_prompt_template(
        app_mode=AppMode.WORKFLOW,
        provider="openai",
        model="gpt-4",
        pre_prompt=pre_prompt,
        has_context=True,
        query_in_prompt=True,
        with_memory_prompt=False,
    )
    prompt_rules = prompt_template["prompt_rules"]
    assert prompt_template["prompt_template"].template == (
        prompt_rules["context_prompt"] + pre_prompt + "\n" + prompt_rules["query_prompt"]
    )
    assert prompt_template["special_variable_keys"] == ["#context#", "#query#"]


def test_get_baichuan_completion_app_prompt_template_with_pcq():
    prompt_transform = SimplePromptTransform()
    pre_prompt = "You are a helpful assistant."
    prompt_template = prompt_transform.get_prompt_template(
        app_mode=AppMode.WORKFLOW,
        provider="baichuan",
        model="Baichuan2-53B",
        pre_prompt=pre_prompt,
        has_context=True,
        query_in_prompt=True,
        with_memory_prompt=False,
    )
    prompt_rules = prompt_template["prompt_rules"]
    assert prompt_template["prompt_template"].template == (
        prompt_rules["context_prompt"] + pre_prompt + "\n" + prompt_rules["query_prompt"]
    )
    assert prompt_template["special_variable_keys"] == ["#context#", "#query#"]


def test_get_common_chat_app_prompt_template_with_q():
    prompt_transform = SimplePromptTransform()
    pre_prompt = ""
    prompt_template = prompt_transform.get_prompt_template(
        app_mode=AppMode.CHAT,
        provider="openai",
        model="gpt-4",
        pre_prompt=pre_prompt,
        has_context=False,
        query_in_prompt=True,
        with_memory_prompt=False,
    )
    prompt_rules = prompt_template["prompt_rules"]
    assert prompt_template["prompt_template"].template == prompt_rules["query_prompt"]
    assert prompt_template["special_variable_keys"] == ["#query#"]


def test_get_common_chat_app_prompt_template_with_cq():
    prompt_transform = SimplePromptTransform()
    pre_prompt = ""
    prompt_template = prompt_transform.get_prompt_template(
        app_mode=AppMode.CHAT,
        provider="openai",
        model="gpt-4",
        pre_prompt=pre_prompt,
        has_context=True,
        query_in_prompt=True,
        with_memory_prompt=False,
    )
    prompt_rules = prompt_template["prompt_rules"]
    assert prompt_template["prompt_template"].template == (
        prompt_rules["context_prompt"] + prompt_rules["query_prompt"]
    )
    assert prompt_template["special_variable_keys"] == ["#context#", "#query#"]


def test_get_common_chat_app_prompt_template_with_p():
    prompt_transform = SimplePromptTransform()
    pre_prompt = "you are {{name}}"
    prompt_template = prompt_transform.get_prompt_template(
        app_mode=AppMode.CHAT,
        provider="openai",
        model="gpt-4",
        pre_prompt=pre_prompt,
        has_context=False,
        query_in_prompt=False,
        with_memory_prompt=False,
    )
    assert prompt_template["prompt_template"].template == pre_prompt + "\n"
    assert prompt_template["custom_variable_keys"] == ["name"]
    assert prompt_template["special_variable_keys"] == []


def test__get_chat_model_prompt_messages():
    model_config_mock = MagicMock(spec=ModelConfigWithCredentialsEntity)
    model_config_mock.provider = "openai"
    model_config_mock.model = "gpt-4"

    memory_mock = MagicMock(spec=TokenBufferMemory)
    history_prompt_messages = [UserPromptMessage(content="Hi"), AssistantPromptMessage(content="Hello")]
    memory_mock.get_history_prompt_messages.return_value = history_prompt_messages

    prompt_transform = SimplePromptTransform()
    prompt_transform._calculate_rest_token = MagicMock(return_value=2000)

    pre_prompt = "You are a helpful assistant {{name}}."
    inputs = {"name": "John"}
    context = "yes or no."
    query = "How are you?"
    prompt_messages, _ = prompt_transform._get_chat_model_prompt_messages(
        app_mode=AppMode.CHAT,
        pre_prompt=pre_prompt,
        inputs=inputs,
        query=query,
        files=[],
        context=context,
        memory=memory_mock,
        model_config=model_config_mock,
    )

    prompt_template = prompt_transform.get_prompt_template(
        app_mode=AppMode.CHAT,
        provider=model_config_mock.provider,
        model=model_config_mock.model,
        pre_prompt=pre_prompt,
        has_context=True,
        query_in_prompt=False,
        with_memory_prompt=False,
    )

    full_inputs = {**inputs, "#context#": context}
    real_system_prompt = prompt_template["prompt_template"].format(full_inputs)

    assert len(prompt_messages) == 4
    assert prompt_messages[0].content == real_system_prompt
    assert prompt_messages[1].content == history_prompt_messages[0].content
    assert prompt_messages[2].content == history_prompt_messages[1].content
    assert prompt_messages[3].content == query


def test__get_completion_model_prompt_messages():
    model_config_mock = MagicMock(spec=ModelConfigWithCredentialsEntity)
    model_config_mock.provider = "openai"
    model_config_mock.model = "gpt-3.5-turbo-instruct"

    memory = TokenBufferMemory(conversation=Conversation(), model_instance=model_config_mock)

    history_prompt_messages = [UserPromptMessage(content="Hi"), AssistantPromptMessage(content="Hello")]
    memory.get_history_prompt_messages = MagicMock(return_value=history_prompt_messages)

    prompt_transform = SimplePromptTransform()
    prompt_transform._calculate_rest_token = MagicMock(return_value=2000)
    pre_prompt = "You are a helpful assistant {{name}}."
    inputs = {"name": "John"}
    context = "yes or no."
    query = "How are you?"
    prompt_messages, stops = prompt_transform._get_completion_model_prompt_messages(
        app_mode=AppMode.CHAT,
        pre_prompt=pre_prompt,
        inputs=inputs,
        query=query,
        files=[],
        context=context,
        memory=memory,
        model_config=model_config_mock,
    )

    prompt_template = prompt_transform.get_prompt_template(
        app_mode=AppMode.CHAT,
        provider=model_config_mock.provider,
        model=model_config_mock.model,
        pre_prompt=pre_prompt,
        has_context=True,
        query_in_prompt=True,
        with_memory_prompt=True,
    )

    prompt_rules = prompt_template["prompt_rules"]
    full_inputs = {
        **inputs,
        "#context#": context,
        "#query#": query,
        "#histories#": memory.get_history_prompt_text(
            max_token_limit=2000,
            human_prefix=prompt_rules.get("human_prefix", "Human"),
            ai_prefix=prompt_rules.get("assistant_prefix", "Assistant"),
        ),
    }
    real_prompt = prompt_template["prompt_template"].format(full_inputs)

    assert len(prompt_messages) == 1
    assert stops == prompt_rules.get("stops")
    assert prompt_messages[0].content == real_prompt


def test_get_prompt_dispatches_chat_and_completion():
    transform = SimplePromptTransform()
    model_config_chat = MagicMock(spec=ModelConfigWithCredentialsEntity)
    model_config_chat.mode = "chat"
    model_config_completion = MagicMock(spec=ModelConfigWithCredentialsEntity)
    model_config_completion.mode = "completion"
    prompt_entity = SimpleNamespace(simple_prompt_template="hello")

    transform._get_chat_model_prompt_messages = MagicMock(return_value=(["chat-msg"], None))
    transform._get_completion_model_prompt_messages = MagicMock(return_value=(["completion-msg"], ["stop"]))

    chat_messages, chat_stops = transform.get_prompt(
        app_mode=AppMode.CHAT,
        prompt_template_entity=prompt_entity,
        inputs={"n": 1},
        query="q",
        files=[],
        context=None,
        memory=None,
        model_config=model_config_chat,
    )
    assert chat_messages == ["chat-msg"]
    assert chat_stops is None

    completion_messages, completion_stops = transform.get_prompt(
        app_mode=AppMode.CHAT,
        prompt_template_entity=prompt_entity,
        inputs={"n": 1},
        query="q",
        files=[],
        context=None,
        memory=None,
        model_config=model_config_completion,
    )
    assert completion_messages == ["completion-msg"]
    assert completion_stops == ["stop"]


def test_get_prompt_str_and_rules_type_validation_errors():
    transform = SimplePromptTransform()
    model_config = MagicMock(spec=ModelConfigWithCredentialsEntity)
    model_config.provider = "openai"
    model_config.model = "gpt-4"
    valid_prompt_template = SimplePromptTransform().get_prompt_template(
        AppMode.CHAT, "openai", "gpt-4", "", False, False
    )["prompt_template"]

    bad_custom_keys = {
        "prompt_template": valid_prompt_template,
        "custom_variable_keys": "not-list",
        "special_variable_keys": [],
        "prompt_rules": {},
    }
    transform.get_prompt_template = MagicMock(return_value=bad_custom_keys)
    with pytest.raises(TypeError, match="custom_variable_keys"):
        transform._get_prompt_str_and_rules(AppMode.CHAT, model_config, "", {}, query=None, context=None)

    bad_special_keys = {
        **bad_custom_keys,
        "custom_variable_keys": [],
        "special_variable_keys": "not-list",
    }
    transform.get_prompt_template = MagicMock(return_value=bad_special_keys)
    with pytest.raises(TypeError, match="special_variable_keys"):
        transform._get_prompt_str_and_rules(AppMode.CHAT, model_config, "", {}, query=None, context=None)

    bad_prompt_template = {
        **bad_custom_keys,
        "custom_variable_keys": [],
        "special_variable_keys": [],
        "prompt_template": 123,
    }
    transform.get_prompt_template = MagicMock(return_value=bad_prompt_template)
    with pytest.raises(TypeError, match="PromptTemplateParser"):
        transform._get_prompt_str_and_rules(AppMode.CHAT, model_config, "", {}, query=None, context=None)

    bad_prompt_rules = {
        **bad_custom_keys,
        "custom_variable_keys": [],
        "special_variable_keys": [],
        "prompt_template": valid_prompt_template,
        "prompt_rules": "not-dict",
    }
    transform.get_prompt_template = MagicMock(return_value=bad_prompt_rules)
    with pytest.raises(TypeError, match="prompt_rules"):
        transform._get_prompt_str_and_rules(AppMode.CHAT, model_config, "", {}, query=None, context=None)


def test_chat_model_prompt_messages_uses_prompt_when_query_empty():
    transform = SimplePromptTransform()
    model_config = MagicMock(spec=ModelConfigWithCredentialsEntity)
    transform._get_prompt_str_and_rules = MagicMock(return_value=("prompt-text", {}))
    transform._get_last_user_message = MagicMock(return_value=UserPromptMessage(content="prompt-text"))

    prompt_messages, _ = transform._get_chat_model_prompt_messages(
        app_mode=AppMode.CHAT,
        pre_prompt="",
        inputs={},
        query="",
        files=[],
        context=None,
        memory=None,
        model_config=model_config,
    )

    assert prompt_messages[0].content == "prompt-text"
    transform._get_last_user_message.assert_called_once_with("prompt-text", [], None, None)


def test_completion_model_prompt_messages_empty_stops_becomes_none():
    transform = SimplePromptTransform()
    model_config = MagicMock(spec=ModelConfigWithCredentialsEntity)
    transform._get_prompt_str_and_rules = MagicMock(return_value=("prompt", {"stops": []}))

    prompt_messages, stops = transform._get_completion_model_prompt_messages(
        app_mode=AppMode.CHAT,
        pre_prompt="",
        inputs={},
        query="q",
        files=[],
        context=None,
        memory=None,
        model_config=model_config,
    )

    assert len(prompt_messages) == 1
    assert stops is None


def test_get_last_user_message_with_files_and_context_files():
    transform = SimplePromptTransform()
    file = SimpleNamespace()
    context_file = SimpleNamespace()

    with patch("core.prompt.simple_prompt_transform.file_manager.to_prompt_message_content") as to_content:
        to_content.side_effect = [
            ImagePromptMessageContent(url="https://example.com/a.jpg", format="jpg", mime_type="image/jpg"),
            ImagePromptMessageContent(url="https://example.com/b.jpg", format="jpg", mime_type="image/jpg"),
        ]
        message = transform._get_last_user_message(
            prompt="hello",
            files=[file],
            context_files=[context_file],
            image_detail_config=None,
        )

    assert isinstance(message.content, list)
    assert message.content[0].data == "https://example.com/a.jpg"
    assert message.content[1].data == "https://example.com/b.jpg"
    assert isinstance(message.content[2], TextPromptMessageContent)
    assert message.content[2].data == "hello"


def test_prompt_file_name_branches():
    transform = SimplePromptTransform()

    assert transform._prompt_file_name(AppMode.CHAT, "openai", "gpt-4") == "common_chat"
    assert transform._prompt_file_name(AppMode.COMPLETION, "openai", "gpt-4") == "common_completion"
    assert transform._prompt_file_name(AppMode.COMPLETION, "baichuan", "Baichuan2") == "baichuan_completion"
    assert transform._prompt_file_name(AppMode.CHAT, "huggingface_hub", "baichuan-13b") == "baichuan_chat"


def test_advanced_prompt_templates_constants_are_importable():
    assert isinstance(CONTEXT, str)
    assert isinstance(BAICHUAN_CONTEXT, str)
    assert "completion_prompt_config" in CHAT_APP_COMPLETION_PROMPT_CONFIG
    assert "chat_prompt_config" in CHAT_APP_CHAT_PROMPT_CONFIG
    assert "chat_prompt_config" in COMPLETION_APP_CHAT_PROMPT_CONFIG
    assert "completion_prompt_config" in COMPLETION_APP_COMPLETION_PROMPT_CONFIG
    assert "completion_prompt_config" in BAICHUAN_CHAT_APP_COMPLETION_PROMPT_CONFIG
    assert "chat_prompt_config" in BAICHUAN_CHAT_APP_CHAT_PROMPT_CONFIG
    assert "chat_prompt_config" in BAICHUAN_COMPLETION_APP_CHAT_PROMPT_CONFIG
    assert "completion_prompt_config" in BAICHUAN_COMPLETION_APP_COMPLETION_PROMPT_CONFIG
