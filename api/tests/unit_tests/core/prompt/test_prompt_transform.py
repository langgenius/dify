from unittest.mock import MagicMock

from core.app.app_config.entities import ModelConfigEntity
from core.entities.provider_configuration import ProviderConfiguration, ProviderModelBundle
from core.model_runtime.entities.message_entities import UserPromptMessage
from core.model_runtime.entities.model_entities import AIModelEntity, ModelPropertyKey, ParameterRule
from core.model_runtime.entities.provider_entities import ProviderEntity
from core.model_runtime.model_providers.__base.large_language_model import LargeLanguageModel
from core.prompt.prompt_transform import PromptTransform


def test__calculate_rest_token():
    model_schema_mock = MagicMock(spec=AIModelEntity)
    parameter_rule_mock = MagicMock(spec=ParameterRule)
    parameter_rule_mock.name = 'max_tokens'
    model_schema_mock.parameter_rules = [
        parameter_rule_mock
    ]
    model_schema_mock.model_properties = {
        ModelPropertyKey.CONTEXT_SIZE: 62
    }

    large_language_model_mock = MagicMock(spec=LargeLanguageModel)
    large_language_model_mock.get_num_tokens.return_value = 6

    provider_mock = MagicMock(spec=ProviderEntity)
    provider_mock.provider = 'openai'

    provider_configuration_mock = MagicMock(spec=ProviderConfiguration)
    provider_configuration_mock.provider = provider_mock
    provider_configuration_mock.model_settings = None

    provider_model_bundle_mock = MagicMock(spec=ProviderModelBundle)
    provider_model_bundle_mock.model_type_instance = large_language_model_mock
    provider_model_bundle_mock.configuration = provider_configuration_mock

    model_config_mock = MagicMock(spec=ModelConfigEntity)
    model_config_mock.model = 'gpt-4'
    model_config_mock.credentials = {}
    model_config_mock.parameters = {
        'max_tokens': 50
    }
    model_config_mock.model_schema = model_schema_mock
    model_config_mock.provider_model_bundle = provider_model_bundle_mock

    prompt_transform = PromptTransform()

    prompt_messages = [UserPromptMessage(content="Hello, how are you?")]
    rest_tokens = prompt_transform._calculate_rest_token(prompt_messages, model_config_mock)

    # Validate based on the mock configuration and expected logic
    expected_rest_tokens = (model_schema_mock.model_properties[ModelPropertyKey.CONTEXT_SIZE]
                            - model_config_mock.parameters['max_tokens']
                            - large_language_model_mock.get_num_tokens.return_value)
    assert rest_tokens == expected_rest_tokens
    assert rest_tokens == 6
