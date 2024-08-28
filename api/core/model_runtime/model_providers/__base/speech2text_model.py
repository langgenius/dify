import os
from abc import abstractmethod
from typing import IO, Optional

from pydantic import ConfigDict

from core.model_runtime.entities.model_entities import ModelType
from core.model_runtime.model_providers.__base.ai_model import AIModel


class Speech2TextModel(AIModel):
    """
    Model class for speech2text model.
    """
    model_type: ModelType = ModelType.SPEECH2TEXT

    # pydantic configs
    model_config = ConfigDict(protected_namespaces=())

    def invoke(self, model: str, 
               credentials: dict,
               file: IO[bytes], user: Optional[str] = None,  
               language: Optional[str] = None,
               prompt: Optional[str] = None,
               response_format: Optional[str] = "json",
               temperature: Optional[float] = 0,) \
            -> str:
        """
        Invoke large language model

        :param model: model name
        :param credentials: model credentials
        :param file: The audio file object (not file name) to transcribe, in one of these formats: flac, mp3, mp4, mpeg, mpga, m4a, ogg, wav, or webm.
        :param user: unique user id
        :param language: The language of the input audio. Supplying the input language in ISO-639-1
        :param prompt: An optional text to guide the model's style or continue a previous audio segment. The prompt should match the audio language.
        :param response_format: The format of the transcript output, in one of these options: json, text, srt, verbose_json, or vtt.
        :param temperature: The sampling temperature, between 0 and 1. Higher values like 0.8 will make the output more random, while lower values like 0.2 will make it more focused and deterministic. If set to 0, the model will use log probability to automatically increase the temperature until certain thresholds are hit.
        :return: text for given audio file
        """
        try:
            return self._invoke(model, credentials, file, user, language, prompt, response_format, temperature)
        except Exception as e:
            raise self._transform_invoke_error(e)

    @abstractmethod
    def _invoke(self, model: str, credentials: dict,
                file: IO[bytes], user: Optional[str] = None,  
                language: Optional[str] = None,
                prompt: Optional[str] = None,
                response_format: Optional[str] = "json",
                temperature: Optional[float] = 0) \
            -> str:
        """
        Invoke large language model

        :param model: model name
        :param credentials: model credentials
        :param file: audio file
        :param user: unique user id
        :param language: The language of the input audio. Supplying the input language in ISO-639-1
        :param prompt: An optional text to guide the model's style or continue a previous audio segment. The prompt should match the audio language.
        :param response_format: The format of the transcript output, in one of these options: json, text, srt, verbose_json, or vtt.
        :param temperature: The sampling temperature, between 0 and 1. Higher values like 0.8 will make the output more random, while lower values like 0.2 will make it more focused and deterministic. If set to 0, the model will use log probability to automatically increase the temperature until certain thresholds are hit.
        :return: text for given audio file
        """
        raise NotImplementedError

    def _get_demo_file_path(self) -> str:
        """
        Get demo file for given model

        :return: demo file
        """
        # Get the directory of the current file
        current_dir = os.path.dirname(os.path.abspath(__file__))

        # Construct the path to the audio file
        return os.path.join(current_dir, 'audio.mp3')
