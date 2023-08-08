import openai
import io
from core.llm.wrappers.openai_wrapper import handle_openai_exceptions
from models.provider import ProviderName
from core.llm.provider.base import BaseProvider
from core.asr.base import Audio

class Whisper(Audio):

    def __init__(self, provider: BaseProvider):
        self.provider = provider

        if self.provider.get_provider_name() == ProviderName.OPENAI:
            self.client = openai.Audio
            self.credentials = provider.get_credentials()

    @handle_openai_exceptions
    def transcribe(self, audio_in):

        buffer = io.BytesIO(audio_in)
        buffer.name = 'temp.mp3'
        return self.client.transcribe(
            model='whisper-1',
            file=buffer,
            api_key=self.credentials.get('openai_api_key'),
            api_base=self.credentials.get('openai_api_base'),
            api_type=self.credentials.get('openai_api_type'),
            api_version=self.credentials.get('openai_api_version'),
        )
