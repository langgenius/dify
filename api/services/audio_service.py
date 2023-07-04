import openai
from core.llm.llm_builder import LLMBuilder
from core.llm.provider.llm_provider_service import LLMProviderService
from models.model import App
from controllers.console.datasets.error import FileTooLargeError, \
    UnsupportedFileTypeError

FILE_SIZE_LIMIT = 25 * 1024 * 1024  # 25MB
ALLOWED_EXTENSIONS = ['mp3', 'mp4', 'mpeg', 'mpga', 'm4a', 'wav', 'webm']

class AudioService:
    @classmethod
    def transcript(cls, app_model: App, file, **params):
        file_content = file.read()
        file_size = len(file_content)

        if file_size > FILE_SIZE_LIMIT:
            message = "({file_size} > {FILE_SIZE_LIMIT})"
            raise FileTooLargeError(message)
        
        extension = file.filename.split('.')[-1]
        if extension not in ALLOWED_EXTENSIONS:
            raise UnsupportedFileTypeError()

        provider_name = LLMBuilder.get_default_provider(app_model.tenant_id)
        provider = LLMProviderService(app_model.tenant_id, provider_name)
        credentials = provider.get_credentials(provider_name)

        transcript = openai.Audio.transcribe(
                        model='whisper-1', 
                        file=file,
                        api_key=credentials.get('openai_api_key'),
                        api_base=credentials.get('openai_api_base'),
                        api_type=credentials.get('openai_api_type'),
                        api_version=credentials.get('openai_api_version'),
                        params=params
                    )
        
        return transcript