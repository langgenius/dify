import openai

from core.model_providers.models.base import BaseProviderModel
from core.model_providers.models.entity.model_params import ModelType
from core.model_providers.providers.base import BaseModelProvider

DEFAULT_AUDIO_MODEL = 'whisper-1'


class OpenAIModeration(BaseProviderModel):
    type: ModelType = ModelType.MODERATION

    def __init__(self, model_provider: BaseModelProvider, name: str):
        super().__init__(model_provider, openai.Moderation)

    def run(self, text):
        credentials = self.model_provider.get_model_credentials(
            model_name=DEFAULT_AUDIO_MODEL,
            model_type=self.type
        )
        return self._client.create(input=text, api_key=credentials['openai_api_key'])
