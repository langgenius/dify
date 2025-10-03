import os
import pytest

from core.model_runtime.entities.llm_entities import LLMResult, LLMResultChunk
from core.model_runtime.entities.message_entities import AssistantPromptMessage, PromptMessageTool, SystemPromptMessage, UserPromptMessage
from core.model_runtime.errors.validate import CredentialsValidateFailedError
from core.model_runtime.model_providers.gmicloud.llm.llm import GMICloudLargeLanguageModel
from core.plugin.entities.plugin_daemon import PluginModelProviderEntity
from core.model_runtime.entities.provider_entities import ProviderEntity
from core.model_runtime.entities.model_entities import ModelType


def _create_test_model():
    """Create a test model instance with required fields"""
    from core.model_runtime.entities.provider_entities import (
        ProviderCredentialSchema, 
        ModelCredentialSchema,
        FieldModelSchema
    )
    
    # Mock plugin model provider
    provider_credential_schema = ProviderCredentialSchema(
        credential_form_schemas=[]
    )
    
    field_model_schema = FieldModelSchema(
        label={"en_US": "Model"},
        placeholder={"en_US": "Enter model name"}
    )
    
    model_credential_schema = ModelCredentialSchema(
        model=field_model_schema,
        credential_form_schemas=[]
    )
    
    mock_provider_entity = ProviderEntity(
        provider="gmicloud",
        label={"en_US": "GMI Cloud"},
        icon_small={"en_US": "icon.svg"},
        icon_large={"en_US": "icon.svg"},
        supported_model_types=[ModelType.LLM],
        configurate_methods=[],
        provider_credential_schema=provider_credential_schema,
        model_credential_schema=model_credential_schema
    )
    
    mock_plugin_provider = PluginModelProviderEntity(
        id="test-id",
        plugin_unique_identifier="gmicloud",
        plugin_id="gmicloud",
        tenant_id="test-tenant",
        provider="gmicloud",
        declaration=mock_provider_entity,
        created_at="2024-01-01T00:00:00Z",
        updated_at="2024-01-01T00:00:00Z"
    )
    
    return GMICloudLargeLanguageModel(
        tenant_id="test-tenant",
        model_type=ModelType.LLM,
        plugin_id="gmicloud",
        provider_name="gmicloud", 
        plugin_model_provider=mock_plugin_provider
    )


def test_validate_credentials():
    model = _create_test_model()

    with pytest.raises(CredentialsValidateFailedError):
        model.validate_credentials(
            model='deepseek-ai/DeepSeek-V3.1-Terminus',
            credentials={}
        )

    with pytest.raises(CredentialsValidateFailedError):
        model.validate_credentials(
            model='deepseek-ai/DeepSeek-V3.1-Terminus',
            credentials={
                'api_key': 'invalid_key'
            }
        )

    model.validate_credentials(
        model='deepseek-ai/DeepSeek-V3.1-Terminus',
        credentials={
            'api_key': os.environ.get('GMI_CLOUD_API_KEY', 'valid_api_key_for_testing')
        }
    )


def test_invoke_model():
    model = _create_test_model()

    result = model.invoke(
        model='deepseek-ai/DeepSeek-V3.1-Terminus',
        credentials={
            'api_key': os.environ.get('GMI_CLOUD_API_KEY', 'valid_api_key_for_testing')
        },
        prompt_messages=[
            SystemPromptMessage(
                content='You are a helpful AI assistant.',
            ),
            UserPromptMessage(
                content='Hello! How are you?',
            )
        ],
        model_parameters={
            'temperature': 0.5,
            'top_p': 1.0,
        },
        stop=None,
        stream=False
    )

    assert isinstance(result, LLMResult)
    assert len(result.message.content) > 0


def test_invoke_stream_model():
    model = _create_test_model()

    result = model.invoke(
        model='deepseek-ai/DeepSeek-V3.1-Terminus',
        credentials={
            'api_key': os.environ.get('GMI_CLOUD_API_KEY', 'valid_api_key_for_testing')
        },
        prompt_messages=[
            UserPromptMessage(
                content='Hello! How are you? Please respond in 20 words or less.',
            )
        ],
        model_parameters={
            'temperature': 0.5,
        },
        stream=True
    )

    chunks = list(result)
    assert len(chunks) > 0

    for chunk in chunks:
        assert isinstance(chunk, LLMResultChunk)


def test_get_num_tokens():
    model = _create_test_model()

    num_tokens = model.get_num_tokens(
        model='deepseek-ai/DeepSeek-V3.1-Terminus',
        credentials={
            'api_key': os.environ.get('GMI_CLOUD_API_KEY', 'valid_api_key_for_testing')
        },
        prompt_messages=[
            SystemPromptMessage(
                content='You are a helpful AI assistant.',
            ),
            UserPromptMessage(
                content='Hello World!',
            )
        ]
    )

    assert isinstance(num_tokens, int)
    assert num_tokens > 0
