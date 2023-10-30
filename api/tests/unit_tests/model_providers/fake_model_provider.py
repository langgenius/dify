from typing import Type

from core.model_providers.models.base import BaseProviderModel
from core.model_providers.models.entity.model_params import ModelType, ModelKwargsRules, ModelMode
from core.model_providers.models.llm.openai_model import OpenAIModel
from core.model_providers.providers.base import BaseModelProvider


class FakeModelProvider(BaseModelProvider):
    @property
    def provider_name(self):
        return 'fake'

    def _get_fixed_model_list(self, model_type: ModelType) -> list[dict]:
        return [{'id': 'test_model', 'name': 'Test Model', 'mode': 'completion'}]

    def _get_text_generation_model_mode(self, model_name) -> str:
        return ModelMode.COMPLETION.value

    def get_model_class(self, model_type: ModelType) -> Type[BaseProviderModel]:
        return OpenAIModel

    @classmethod
    def is_provider_credentials_valid_or_raise(cls, credentials: dict):
        pass

    @classmethod
    def encrypt_provider_credentials(cls, tenant_id: str, credentials: dict) -> dict:
        return credentials

    def get_provider_credentials(self, obfuscated: bool = False) -> dict:
        return {}

    @classmethod
    def is_model_credentials_valid_or_raise(cls, model_name: str, model_type: ModelType, credentials: dict):
        pass

    @classmethod
    def encrypt_model_credentials(cls, tenant_id: str, model_name: str, model_type: ModelType,
                                  credentials: dict) -> dict:
        return credentials

    def get_model_parameter_rules(self, model_name: str, model_type: ModelType) -> ModelKwargsRules:
        return ModelKwargsRules()

    def get_model_credentials(self, model_name: str, model_type: ModelType, obfuscated: bool = False) -> dict:
        return {}
