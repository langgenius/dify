import io
from typing import Any
from werkzeug.datastructures import FileStorage
from core.llm.llm_builder import LLMBuilder
from core.llm.provider.llm_provider_service import LLMProviderService
from services.errors.audio import NoAudioUploadedServiceError, AudioTooLargeServiceError, UnsupportedAudioTypeServiceError, ProviderNotSupportSpeechToTextServiceError
from models.provider import ProviderName
import logging
logger = logging.getLogger(__name__)

FILE_SIZE = 15
FILE_SIZE_LIMIT = FILE_SIZE * 1024 * 1024
ALLOWED_EXTENSIONS = ['mp3', 'mp4', 'mpeg', 'mpga', 'm4a', 'wav', 'wave', 'webm']
MODEL_WHISPER = "whisper-1"
MODEL_FUNASR = "funasr"


class AudioService:
    def __init__(self, model: str = MODEL_WHISPER) -> None:
        pass

    def __call__(self,  file: FileStorage, *args: Any, **kwds: Any) -> Any:
        if file is None:
            raise NoAudioUploadedServiceError()
        
        extension = file.mimetype
        if extension not in [f'audio/{ext}' for ext in ALLOWED_EXTENSIONS]:
            raise UnsupportedAudioTypeServiceError()

        file_content = file.read()
        file_size = len(file_content)

        if file_size > FILE_SIZE_LIMIT:
            message = f"Audio size larger than {FILE_SIZE} mb"
            raise AudioTooLargeServiceError(message)

        return self.model.transcribe(file_content)

    @classmethod
    def from_model(cls, tenant_id: str, model: str = MODEL_WHISPER) -> Any:
        if model == MODEL_WHISPER:
            provider_name = LLMBuilder.get_default_provider(tenant_id, MODEL_WHISPER)
            if provider_name != ProviderName.OPENAI.value:
                raise ProviderNotSupportSpeechToTextServiceError()
            provider_service = LLMProviderService(tenant_id, provider_name)
            from core.audio.asr.whisper import Whisper
            cls.model = Whisper(provider_service.provider)
            return cls()
        elif model == MODEL_FUNASR:
            from core.audio.asr.para_asr import ParaformerAsr
            cls.model = ParaformerAsr()
            return cls()
        else:
            raise Exception(f"Transcribe model: {model} not supported")