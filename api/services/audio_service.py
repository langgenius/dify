import io
import openai
from werkzeug.datastructures import FileStorage
from core.llm.llm_builder import LLMBuilder
from core.llm.provider.llm_provider_service import LLMProviderService
from services.errors.audio import NoAudioUploadedError, AudioTooLargeError, UnsupportedAudioTypeError

FILE_SIZE_LIMIT = 1 * 1024 * 1024
ALLOWED_EXTENSIONS = ['mp3', 'mp4', 'mpeg', 'mpga', 'm4a', 'wav', 'webm']

class AudioService:
    @classmethod
    def transcript(cls, tenant_id: str, file: FileStorage, **params):
        if file is None:
            raise NoAudioUploadedError()
        
        extension = file.mimetype
        if extension not in [f'audio/{ext}' for ext in ALLOWED_EXTENSIONS]:
            raise AudioTooLargeError()

        file_content = file.read()
        file_size = len(file_content)

        if file_size > FILE_SIZE_LIMIT:
            message = f"({file_size} > {FILE_SIZE_LIMIT})"
            raise UnsupportedAudioTypeError(message)
        
        provider_name = LLMBuilder.get_default_provider(tenant_id)
        provider = LLMProviderService(tenant_id, provider_name)
        credentials = provider.get_credentials(provider_name)

        buffer = io.BytesIO(file_content)
        buffer.name = 'temp.wav'

        transcript = openai.Audio.transcribe(
                        model='whisper-1', 
                        file=buffer,
                        api_key=credentials.get('openai_api_key'),
                        api_base=credentials.get('openai_api_base'),
                        api_type=credentials.get('openai_api_type'),
                        api_version=credentials.get('openai_api_version'),
                        params=params
                    )
        
        return transcript