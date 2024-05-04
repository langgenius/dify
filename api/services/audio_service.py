import io
import os
import tempfile
from typing import Optional, Union

from moviepy.editor import VideoFileClip
from werkzeug.datastructures import FileStorage

from core.model_manager import ModelManager
from core.model_runtime.entities.model_entities import ModelType
from extensions.ext_storage import storage
from models.model import Account, App, AppMode, EndUser, UploadFile
from services.errors.audio import (
    AudioTooLargeServiceError,
    NoAudioUploadedServiceError,
    ProviderNotSupportSpeechToTextServiceError,
    ProviderNotSupportTextToSpeechServiceError,
    UnsupportedAudioTypeServiceError,
    VideoConvertToAudioError,
)
from services.file_service import VIDEO_EXTENSIONS, FileService

FILE_SIZE = 30
FILE_SIZE_LIMIT = FILE_SIZE * 1024 * 1024
ALLOWED_EXTENSIONS = ['mp3', 'mp4', 'mpeg', 'mpga', 'm4a', 'wav', 'webm', 'amr']


class AudioService:
    @classmethod
    def transcript_asr(cls, app_model: App, file: Union[FileStorage, UploadFile], end_user: Union[Account, EndUser] = None):
        if isinstance(file, UploadFile):
            extension = file.extension.lower()
        else:
            extension = file.mimetype.split('/')[1].lower()

        if app_model.mode in [AppMode.ADVANCED_CHAT.value, AppMode.WORKFLOW.value] and extension not in VIDEO_EXTENSIONS:
            workflow = app_model.workflow
            if workflow is None:
                raise ValueError("Speech to text is not enabled")

            features_dict = workflow.features_dict
            if 'speech_to_text' not in features_dict or not features_dict['speech_to_text'].get('enabled'):
                raise ValueError("Speech to text is not enabled")

        if file is None:
            raise NoAudioUploadedServiceError()

        if extension in ALLOWED_EXTENSIONS:
            if extension in VIDEO_EXTENSIONS:
                try:
                    if isinstance(file, FileStorage):
                        upload_file = FileService.upload_file(file=file, user=end_user)
                    else:
                        upload_file = file

                    # Download the video file to local temp directory
                    with tempfile.TemporaryDirectory() as temp_dir:
                        media_file_path = temp_dir + '/' + os.path.basename(upload_file.key)
                        file_name = os.path.basename(media_file_path).split('.')[0]
                        file_path = os.path.dirname(media_file_path)

                        if not os.path.isfile(media_file_path):
                            storage.download(filename=upload_file.key, target_filepath=media_file_path)

                        # convert the video to audio
                        video_clip = VideoFileClip(media_file_path)
                        audio_clip = video_clip.audio
                        audio_clip.write_audiofile(f'{file_path}/{file_name}.mp3', codec='libmp3lame')
                        with open(f'{file_path}/{file_name}.mp3', 'rb') as audio_file:
                            file_content = audio_file.read()
                except Exception as e:
                    raise VideoConvertToAudioError(str(e))
            else:
                file_content = file.read()
        else:
            raise UnsupportedAudioTypeServiceError()

        file_size = len(file_content)

        if file_size > FILE_SIZE_LIMIT:
            message = f"Audio size larger than {FILE_SIZE} mb"
            raise AudioTooLargeServiceError(message)

        model_manager = ModelManager()
        model_instance = model_manager.get_default_model_instance(
            tenant_id=app_model.tenant_id,
            model_type=ModelType.SPEECH2TEXT
        )
        if model_instance is None:
            raise ProviderNotSupportSpeechToTextServiceError()

        buffer = io.BytesIO(file_content)
        buffer.name = 'temp.mp3'

        return {"text": model_instance.invoke_speech2text(file=buffer, user=end_user)}

    @classmethod
    def transcript_tts(cls, app_model: App, text: str, streaming: bool,
                       voice: Optional[str] = None, end_user: Optional[str] = None):
        if app_model.mode in [AppMode.ADVANCED_CHAT.value, AppMode.WORKFLOW.value]:
            workflow = app_model.workflow
            if workflow is None:
                raise ValueError("TTS is not enabled")

            features_dict = workflow.features_dict
            if 'text_to_speech' not in features_dict or not features_dict['text_to_speech'].get('enabled'):
                raise ValueError("TTS is not enabled")

            voice = features_dict['text_to_speech'].get('voice') if voice is None else voice
        else:
            text_to_speech_dict = app_model.app_model_config.text_to_speech_dict

            if not text_to_speech_dict.get('enabled'):
                raise ValueError("TTS is not enabled")

            voice = text_to_speech_dict.get('voice') if voice is None else voice

        model_manager = ModelManager()
        model_instance = model_manager.get_default_model_instance(
            tenant_id=app_model.tenant_id,
            model_type=ModelType.TTS
        )
        if model_instance is None:
            raise ProviderNotSupportTextToSpeechServiceError()

        try:
            return model_instance.invoke_tts(
                content_text=text.strip(),
                user=end_user,
                streaming=streaming,
                tenant_id=app_model.tenant_id,
                voice=voice
            )
        except Exception as e:
            raise e

    @classmethod
    def transcript_tts_voices(cls, tenant_id: str, language: str):
        model_manager = ModelManager()
        model_instance = model_manager.get_default_model_instance(
            tenant_id=tenant_id,
            model_type=ModelType.TTS
        )
        if model_instance is None:
            raise ProviderNotSupportTextToSpeechServiceError()

        try:
            return model_instance.get_tts_voices(language)
        except Exception as e:
            raise e
