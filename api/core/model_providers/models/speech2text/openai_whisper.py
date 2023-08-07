import openai

from core.model_providers.models.llm.openai_model import handle_openai_exceptions
from core.model_providers.models.speech2text.base import BaseSpeech2Text
from core.model_providers.providers.base import BaseModelProvider


class OpenAIWhisper(BaseSpeech2Text):

    def __init__(self, model_provider: BaseModelProvider, name: str):
        super().__init__(model_provider, openai.Audio, name)

    @handle_openai_exceptions
    def run(self, file):
        credentials = self.model_provider.get_model_credentials(
            model_name=self.name,
            model_type=self.type
        )

        return self._client.transcribe(
            model=self.name,
            file=file,
            api_key=credentials.get('openai_api_key'),
            api_base=credentials.get('openai_api_base'),
            organization=credentials.get('openai_organization'),
        )
