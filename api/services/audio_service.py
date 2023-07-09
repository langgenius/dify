import io
from werkzeug.datastructures import FileStorage
from core.llm.llm_builder import LLMBuilder
from core.llm.provider.llm_provider_service import LLMProviderService
from services.errors.audio import NoAudioUploadedServiceError, AudioTooLargeServiceError, UnsupportedAudioTypeServiceError, ProviderNotSupportSpeechToTextServiceError
from core.llm.whisper import Whisper
from models.provider import ProviderName

FILE_SIZE_LIMIT = 1 * 1024 * 1024
ALLOWED_EXTENSIONS = ['mp3', 'mp4', 'mpeg', 'mpga', 'm4a', 'wav', 'webm']

class AudioService:
    @classmethod
    def transcript(cls, tenant_id: str, file: FileStorage):
        if file is None:
            raise NoAudioUploadedServiceError()
        
        extension = file.mimetype
        if extension not in [f'audio/{ext}' for ext in ALLOWED_EXTENSIONS]:
            raise UnsupportedAudioTypeServiceError()

        file_content = file.read()
        file_size = len(file_content)

        if file_size > FILE_SIZE_LIMIT:
            message = f"({file_size} > {FILE_SIZE_LIMIT})"
            raise AudioTooLargeServiceError(message)
        
        provider_name = LLMBuilder.get_default_provider(tenant_id)
        if provider_name != ProviderName.OPENAI.value:
            raise ProviderNotSupportSpeechToTextServiceError('haha')

        provider_service = LLMProviderService(tenant_id, provider_name)

        buffer = io.BytesIO(file_content)
        buffer.name = 'temp.wav'

        return Whisper(provider_service.provider).transcribe(buffer)



        
        