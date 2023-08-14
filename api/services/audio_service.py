import io
from werkzeug.datastructures import FileStorage
from core.model_providers.model_factory import ModelFactory
from services.errors.audio import NoAudioUploadedServiceError, AudioTooLargeServiceError, UnsupportedAudioTypeServiceError, ProviderNotSupportSpeechToTextServiceError

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

        model = ModelFactory.get_speech2text_model(
            tenant_id=tenant_id
        )

        buffer = io.BytesIO(file_content)
        buffer.name = 'temp.mp3'

        return model.run(buffer)
