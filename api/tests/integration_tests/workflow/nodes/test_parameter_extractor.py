import json
import os
from typing import Optional
from unittest.mock import MagicMock

import pytest

from core.app.entities.app_invoke_entities import InvokeFrom, ModelConfigWithCredentialsEntity
from core.entities.provider_configuration import ProviderConfiguration, ProviderModelBundle
from core.entities.provider_entities import CustomConfiguration, CustomProviderConfiguration, SystemConfiguration
from core.memory.token_buffer_memory import TokenBufferMemory
from core.model_manager import ModelInstance
from core.model_runtime.entities.model_entities import ModelType
from core.model_runtime.model_providers.model_provider_factory import ModelProviderFactory
from core.workflow.entities.node_entities import SystemVariable
from core.workflow.entities.variable_pool import VariablePool
from core.workflow.nodes.base_node import UserFrom
from core.workflow.nodes.parameter_extractor.parameter_extractor_node import ParameterExtractorNode
from extensions.ext_database import db
from models.provider import ProviderType

"""FOR MOCK FIXTURES, DO NOT REMOVE"""
from models.workflow import WorkflowNodeExecutionStatus
from tests.integration_tests.model_runtime.__mock.anthropic import setup_anthropic_mock
from tests.integration_tests.model_runtime.__mock.openai import setup_openai_mock


def get_mocked_fetch_model_config(
    provider: str, model: str, mode: str,
    credentials: dict,
):
    provider_instance = ModelProviderFactory().get_provider_instance(provider)
    model_type_instance = provider_instance.get_model_instance(ModelType.LLM)
    provider_model_bundle = ProviderModelBundle(
        configuration=ProviderConfiguration(
            tenant_id='1',
            provider=provider_instance.get_provider_schema(),
            preferred_provider_type=ProviderType.CUSTOM,
            using_provider_type=ProviderType.CUSTOM,
            system_configuration=SystemConfiguration(
                enabled=False
            ),
            custom_configuration=CustomConfiguration(
                provider=CustomProviderConfiguration(
                    credentials=credentials
                )
            ),
            model_settings=[]
        ),
        provider_instance=provider_instance,
        model_type_instance=model_type_instance
    )
    model_instance = ModelInstance(provider_model_bundle=provider_model_bundle, model=model)
    model_config = ModelConfigWithCredentialsEntity(
        model=model,
        provider=provider,
        mode=mode,
        credentials=credentials,
        parameters={},
        model_schema=model_type_instance.get_model_schema(model),
        provider_model_bundle=provider_model_bundle
    )

    return MagicMock(return_value=(model_instance, model_config))

def get_mocked_fetch_memory(memory_text: str):
    class MemoryMock:
        def get_history_prompt_text(self, human_prefix: str = "Human",
                                ai_prefix: str = "Assistant",
                                max_token_limit: int = 2000,
                                message_limit: Optional[int] = None):
            return memory_text

    return MagicMock(return_value=MemoryMock())

@pytest.mark.parametrize('setup_openai_mock', [['chat']], indirect=True)
def test_function_calling_parameter_extractor(setup_openai_mock):
    """
    Test function calling for parameter extractor.
    """
    node = ParameterExtractorNode(
        tenant_id='1',
        app_id='1',
        workflow_id='1',
        user_id='1',
        invoke_from=InvokeFrom.WEB_APP,
        user_from=UserFrom.ACCOUNT,
        config={
            'id': 'llm',
            'data': {
                'title': '123',
                'type': 'parameter-extractor',
                'model': {
                    'provider': 'openai',
                    'name': 'gpt-3.5-turbo',
                    'mode': 'chat',
                    'completion_params': {}
                },
                'query': ['sys', 'query'],
                'parameters': [{
                    'name': 'location',
                    'type': 'string',
                    'description': 'location',
                    'required': True
                }],
                'instruction': '',
                'reasoning_mode': 'function_call',
                'memory': None,
            }
        }
    )

    node._fetch_model_config = get_mocked_fetch_model_config(
        provider='openai', model='gpt-3.5-turbo', mode='chat', credentials={
            'openai_api_key': os.environ.get('OPENAI_API_KEY')
        }
    )
    db.session.close = MagicMock()

    # construct variable pool
    pool = VariablePool(system_variables={
        SystemVariable.QUERY: 'what\'s the weather in SF',
        SystemVariable.FILES: [],
        SystemVariable.CONVERSATION_ID: 'abababa',
        SystemVariable.USER_ID: 'aaa'
    }, user_inputs={})

    result = node.run(pool)

    assert result.status == WorkflowNodeExecutionStatus.SUCCEEDED
    assert result.outputs.get('location') == 'kawaii'
    assert result.outputs.get('__reason') == None

@pytest.mark.parametrize('setup_openai_mock', [['chat']], indirect=True)
def test_instructions(setup_openai_mock):
    """
    Test chat parameter extractor.
    """
    node = ParameterExtractorNode(
        tenant_id='1',
        app_id='1',
        workflow_id='1',
        user_id='1',
        invoke_from=InvokeFrom.WEB_APP,
        user_from=UserFrom.ACCOUNT,
        config={
            'id': 'llm',
            'data': {
                'title': '123',
                'type': 'parameter-extractor',
                'model': {
                    'provider': 'openai',
                    'name': 'gpt-3.5-turbo',
                    'mode': 'chat',
                    'completion_params': {}
                },
                'query': ['sys', 'query'],
                'parameters': [{
                    'name': 'location',
                    'type': 'string',
                    'description': 'location',
                    'required': True
                }],
                'reasoning_mode': 'function_call',
                'instruction': '{{#sys.query#}}',
                'memory': None,
            }
        }
    )

    node._fetch_model_config = get_mocked_fetch_model_config(
        provider='openai', model='gpt-3.5-turbo', mode='chat', credentials={
            'openai_api_key': os.environ.get('OPENAI_API_KEY')
        }
    )
    db.session.close = MagicMock()

    # construct variable pool
    pool = VariablePool(system_variables={
        SystemVariable.QUERY: 'what\'s the weather in SF',
        SystemVariable.FILES: [],
        SystemVariable.CONVERSATION_ID: 'abababa',
        SystemVariable.USER_ID: 'aaa'
    }, user_inputs={})

    result = node.run(pool)

    assert result.status == WorkflowNodeExecutionStatus.SUCCEEDED
    assert result.outputs.get('location') == 'kawaii'
    assert result.outputs.get('__reason') == None

    process_data = result.process_data

    process_data.get('prompts')

    for prompt in process_data.get('prompts'):
        if prompt.get('role') == 'system':
            assert 'what\'s the weather in SF' in prompt.get('text')

@pytest.mark.parametrize('setup_anthropic_mock', [['none']], indirect=True)
def test_chat_parameter_extractor(setup_anthropic_mock):
    """
    Test chat parameter extractor.
    """
    node = ParameterExtractorNode(
        tenant_id='1',
        app_id='1',
        workflow_id='1',
        user_id='1',
        invoke_from=InvokeFrom.WEB_APP,
        user_from=UserFrom.ACCOUNT,
        config={
            'id': 'llm',
            'data': {
                'title': '123',
                'type': 'parameter-extractor',
                'model': {
                    'provider': 'anthropic',
                    'name': 'claude-2',
                    'mode': 'chat',
                    'completion_params': {}
                },
                'query': ['sys', 'query'],
                'parameters': [{
                    'name': 'location',
                    'type': 'string',
                    'description': 'location',
                    'required': True
                }],
                'reasoning_mode': 'prompt',
                'instruction': '',
                'memory': None,
            }
        }
    )

    node._fetch_model_config = get_mocked_fetch_model_config(
        provider='anthropic', model='claude-2', mode='chat', credentials={
            'anthropic_api_key': os.environ.get('ANTHROPIC_API_KEY')
        }
    )
    db.session.close = MagicMock()

    # construct variable pool
    pool = VariablePool(system_variables={
        SystemVariable.QUERY: 'what\'s the weather in SF',
        SystemVariable.FILES: [],
        SystemVariable.CONVERSATION_ID: 'abababa',
        SystemVariable.USER_ID: 'aaa'
    }, user_inputs={})

    result = node.run(pool)

    assert result.status == WorkflowNodeExecutionStatus.SUCCEEDED
    assert result.outputs.get('location') == ''
    assert result.outputs.get('__reason') == 'Failed to extract result from function call or text response, using empty result.'
    prompts = result.process_data.get('prompts')

    for prompt in prompts:
        if prompt.get('role') == 'user':
            if '<structure>' in prompt.get('text'):
                assert '<structure>\n{"type": "object"' in prompt.get('text')

@pytest.mark.parametrize('setup_openai_mock', [['completion']], indirect=True)
def test_completion_parameter_extractor(setup_openai_mock):
    """
    Test completion parameter extractor.
    """
    node = ParameterExtractorNode(
        tenant_id='1',
        app_id='1',
        workflow_id='1',
        user_id='1',
        invoke_from=InvokeFrom.WEB_APP,
        user_from=UserFrom.ACCOUNT,
        config={
            'id': 'llm',
            'data': {
                'title': '123',
                'type': 'parameter-extractor',
                'model': {
                    'provider': 'openai',
                    'name': 'gpt-3.5-turbo-instruct',
                    'mode': 'completion',
                    'completion_params': {}
                },
                'query': ['sys', 'query'],
                'parameters': [{
                    'name': 'location',
                    'type': 'string',
                    'description': 'location',
                    'required': True
                }],
                'reasoning_mode': 'prompt',
                'instruction': '{{#sys.query#}}',
                'memory': None,
            }
        }
    )

    node._fetch_model_config = get_mocked_fetch_model_config(
        provider='openai', model='gpt-3.5-turbo-instruct', mode='completion', credentials={
            'openai_api_key': os.environ.get('OPENAI_API_KEY')
        }
    )
    db.session.close = MagicMock()

    # construct variable pool
    pool = VariablePool(system_variables={
        SystemVariable.QUERY: 'what\'s the weather in SF',
        SystemVariable.FILES: [],
        SystemVariable.CONVERSATION_ID: 'abababa',
        SystemVariable.USER_ID: 'aaa'
    }, user_inputs={})

    result = node.run(pool)

    assert result.status == WorkflowNodeExecutionStatus.SUCCEEDED
    assert result.outputs.get('location') == ''
    assert result.outputs.get('__reason') == 'Failed to extract result from function call or text response, using empty result.'
    assert len(result.process_data.get('prompts')) == 1
    assert 'SF' in result.process_data.get('prompts')[0].get('text')

def test_extract_json_response():
    """
    Test extract json response.
    """

    node = ParameterExtractorNode(
        tenant_id='1',
        app_id='1',
        workflow_id='1',
        user_id='1',
        invoke_from=InvokeFrom.WEB_APP,
        user_from=UserFrom.ACCOUNT,
        config={
            'id': 'llm',
            'data': {
                'title': '123',
                'type': 'parameter-extractor',
                'model': {
                    'provider': 'openai',
                    'name': 'gpt-3.5-turbo-instruct',
                    'mode': 'completion',
                    'completion_params': {}
                },
                'query': ['sys', 'query'],
                'parameters': [{
                    'name': 'location',
                    'type': 'string',
                    'description': 'location',
                    'required': True
                }],
                'reasoning_mode': 'prompt',
                'instruction': '{{#sys.query#}}',
                'memory': None,
            }
        }
    )

    result = node._extract_complete_json_response("""
        uwu{ovo}
        {
            "location": "kawaii"
        }
        hello world.                          
    """)

    assert result['location'] == 'kawaii'

@pytest.mark.parametrize('setup_anthropic_mock', [['none']], indirect=True)
def test_chat_parameter_extractor_with_memory(setup_anthropic_mock):
    """
    Test chat parameter extractor with memory.
    """
    node = ParameterExtractorNode(
        tenant_id='1',
        app_id='1',
        workflow_id='1',
        user_id='1',
        invoke_from=InvokeFrom.WEB_APP,
        user_from=UserFrom.ACCOUNT,
        config={
            'id': 'llm',
            'data': {
                'title': '123',
                'type': 'parameter-extractor',
                'model': {
                    'provider': 'anthropic',
                    'name': 'claude-2',
                    'mode': 'chat',
                    'completion_params': {}
                },
                'query': ['sys', 'query'],
                'parameters': [{
                    'name': 'location',
                    'type': 'string',
                    'description': 'location',
                    'required': True
                }],
                'reasoning_mode': 'prompt',
                'instruction': '',
                'memory': {
                    'window': {
                        'enabled': True,
                        'size': 50
                    }
                },
            }
        }
    )

    node._fetch_model_config = get_mocked_fetch_model_config(
        provider='anthropic', model='claude-2', mode='chat', credentials={
            'anthropic_api_key': os.environ.get('ANTHROPIC_API_KEY')
        }
    )
    node._fetch_memory = get_mocked_fetch_memory('customized memory')
    db.session.close = MagicMock()

    # construct variable pool
    pool = VariablePool(system_variables={
        SystemVariable.QUERY: 'what\'s the weather in SF',
        SystemVariable.FILES: [],
        SystemVariable.CONVERSATION_ID: 'abababa',
        SystemVariable.USER_ID: 'aaa'
    }, user_inputs={})

    result = node.run(pool)

    assert result.status == WorkflowNodeExecutionStatus.SUCCEEDED
    assert result.outputs.get('location') == ''
    assert result.outputs.get('__reason') == 'Failed to extract result from function call or text response, using empty result.'
    prompts = result.process_data.get('prompts')

    latest_role = None
    for prompt in prompts:
        if prompt.get('role') == 'user':
            if '<structure>' in prompt.get('text'):
                assert '<structure>\n{"type": "object"' in prompt.get('text')
        elif prompt.get('role') == 'system':
            assert 'customized memory' in prompt.get('text')

        if latest_role is not None:
            assert latest_role != prompt.get('role')

        if prompt.get('role') in ['user', 'assistant']:
            latest_role = prompt.get('role')