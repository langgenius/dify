import openai

from core.llm.wrappers.openai_wrapper import handle_openai_exceptions
from models.provider import ProviderName
from core.llm.provider.base import BaseProvider


class Whisper:

    def __init__(self, provider: BaseProvider):
        self.provider = provider

        if self.provider.get_provider_name() == ProviderName.OPENAI:
            self.client = openai.Audio
            self.credentials = provider.get_credentials()

    @handle_openai_exceptions
    def transcribe(self, file):
        return self.client.transcribe(
            model='whisper-1', 
            file=file,
            api_key=self.credentials.get('openai_api_key'),
            api_base=self.credentials.get('openai_api_base'),
            api_type=self.credentials.get('openai_api_type'),
            api_version=self.credentials.get('openai_api_version'),
        )
