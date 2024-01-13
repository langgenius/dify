import io

from core.model_manager import ModelManager
from core.model_runtime.entities.model_entities import ModelType
from services.errors.audio import (AudioTooLargeServiceError, NoAudioUploadedServiceError,
                                   ProviderNotSupportSpeechToTextServiceError, UnsupportedAudioTypeServiceError)
from werkzeug.datastructures import FileStorage

FILE_SIZE = 15
FILE_SIZE_LIMIT = FILE_SIZE * 1024 * 1024
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
            message = f"Audio size larger than {FILE_SIZE} mb"
            raise AudioTooLargeServiceError(message)

        model_manager = ModelManager()
        model_instance = model_manager.get_default_model_instance(
            tenant_id=tenant_id,
            model_type=ModelType.SPEECH2TEXT
        )

        buffer = io.BytesIO(file_content)
        buffer.name = 'temp.mp3'

        return {"text": model_instance.invoke_speech2text(buffer)}
