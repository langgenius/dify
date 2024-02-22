from unittest.mock import MagicMock

from core.entities.application_entities import ModelConfigEntity
from core.prompt.simple_prompt_transform import SimplePromptTransform
from models.model import AppMode


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
    prompt_rules = prompt_template['prompt_rules']
    assert prompt_template['prompt_template'].template == (prompt_rules['context_prompt']
                                                           + pre_prompt + '\n'
                                                           + prompt_rules['histories_prompt']
                                                           + prompt_rules['query_prompt'])
    assert prompt_template['special_variable_keys'] == ['#context#', '#histories#', '#query#']


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
    prompt_rules = prompt_template['prompt_rules']
    assert prompt_template['prompt_template'].template == (prompt_rules['context_prompt']
                                                           + pre_prompt + '\n'
                                                           + prompt_rules['histories_prompt']
                                                           + prompt_rules['query_prompt'])
    assert prompt_template['special_variable_keys'] == ['#context#', '#histories#', '#query#']


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
    prompt_rules = prompt_template['prompt_rules']
    assert prompt_template['prompt_template'].template == (prompt_rules['context_prompt']
                                                           + pre_prompt + '\n'
                                                           + prompt_rules['query_prompt'])
    assert prompt_template['special_variable_keys'] == ['#context#', '#query#']


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
    print(prompt_template['prompt_template'].template)
    prompt_rules = prompt_template['prompt_rules']
    assert prompt_template['prompt_template'].template == (prompt_rules['context_prompt']
                                                           + pre_prompt + '\n'
                                                           + prompt_rules['query_prompt'])
    assert prompt_template['special_variable_keys'] == ['#context#', '#query#']


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
    prompt_rules = prompt_template['prompt_rules']
    assert prompt_template['prompt_template'].template == prompt_rules['query_prompt']
    assert prompt_template['special_variable_keys'] == ['#query#']


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
    prompt_rules = prompt_template['prompt_rules']
    assert prompt_template['prompt_template'].template == (prompt_rules['context_prompt']
                                                           + prompt_rules['query_prompt'])
    assert prompt_template['special_variable_keys'] == ['#context#', '#query#']


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
    assert prompt_template['prompt_template'].template == pre_prompt + '\n'
    assert prompt_template['custom_variable_keys'] == ['name']
    assert prompt_template['special_variable_keys'] == []


def test__get_chat_model_prompt_messages():
    model_config_mock = MagicMock(spec=ModelConfigEntity)
    model_config_mock.provider = 'openai'
    model_config_mock.model = 'gpt-4'

    prompt_transform = SimplePromptTransform()
    pre_prompt = "You are a helpful assistant {{name}}."
    inputs = {
        "name": "John"
    }
    context = "yes or no."
    query = "How are you?"
    prompt_messages, _ = prompt_transform._get_chat_model_prompt_messages(
        pre_prompt=pre_prompt,
        inputs=inputs,
        query=query,
        files=[],
        context=context,
        memory=None,
        model_config=model_config_mock
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

    full_inputs = {**inputs, '#context#': context}
    real_system_prompt = prompt_template['prompt_template'].format(full_inputs)

    assert len(prompt_messages) == 2
    assert prompt_messages[0].content == real_system_prompt
    assert prompt_messages[1].content == query


def test__get_completion_model_prompt_messages():
    model_config_mock = MagicMock(spec=ModelConfigEntity)
    model_config_mock.provider = 'openai'
    model_config_mock.model = 'gpt-3.5-turbo-instruct'

    prompt_transform = SimplePromptTransform()
    pre_prompt = "You are a helpful assistant {{name}}."
    inputs = {
        "name": "John"
    }
    context = "yes or no."
    query = "How are you?"
    prompt_messages, stops = prompt_transform._get_completion_model_prompt_messages(
        pre_prompt=pre_prompt,
        inputs=inputs,
        query=query,
        files=[],
        context=context,
        memory=None,
        model_config=model_config_mock
    )

    prompt_template = prompt_transform.get_prompt_template(
        app_mode=AppMode.CHAT,
        provider=model_config_mock.provider,
        model=model_config_mock.model,
        pre_prompt=pre_prompt,
        has_context=True,
        query_in_prompt=True,
        with_memory_prompt=False,
    )

    full_inputs = {**inputs, '#context#': context, '#query#': query}
    real_prompt = prompt_template['prompt_template'].format(full_inputs)

    assert len(prompt_messages) == 1
    assert stops == prompt_template['prompt_rules'].get('stops')
    assert prompt_messages[0].content == real_prompt
