from typing import IO, Optional

from openai import OpenAI

from core.model_runtime.errors.validate import CredentialsValidateFailedError
from core.model_runtime.model_providers.__base.speech2text_model import Speech2TextModel
from core.model_runtime.model_providers.openai._common import _CommonOpenAI


class OpenAISpeech2TextModel(_CommonOpenAI, Speech2TextModel):
    """
    Model class for OpenAI Speech to text model.
    """

    def _invoke(
            self, 
            model: str, 
            credentials: dict,
            file: IO[bytes], 
            user: Optional[str] = None,
            language: Optional[str] = None,
            prompt: Optional[str] = None,
            response_format: Optional[str] = "json",
            temperature: Optional[float] = 0,
            ) -> str:
        """
        Invoke speech2text model

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
        return self._speech2text_invoke(model, credentials, file, language=language, prompt=prompt, response_format=response_format, temperature=temperature)

    def validate_credentials(self, model: str, credentials: dict) -> None:
        """
        Validate model credentials

        :param model: model name
        :param credentials: model credentials
        :return:
        """
        try:
            audio_file_path = self._get_demo_file_path()

            with open(audio_file_path, 'rb') as audio_file:
                self._speech2text_invoke(model, credentials, audio_file)
        except Exception as ex:
            raise CredentialsValidateFailedError(str(ex))

    def _speech2text_invoke(
        self,
        model: str,
        credentials: dict,
        file: IO[bytes],
        language: Optional[str] = None,
        prompt: Optional[str] = None,
        response_format: Optional[str] = "json",
        temperature: Optional[float] = 0,
    ) -> str:
        """
        Invoke speech2text model

        :param model: model name
        :param credentials: model credentials
        :param file: The audio file object (not file name) to transcribe, in one of these formats: flac, mp3, mp4, mpeg, mpga, m4a, ogg, wav, or webm.
        :param language: The language of the input audio. Supplying the input language in ISO-639-1
        :param prompt: An optional text to guide the model's style or continue a previous audio segment. The prompt should match the audio language.
        :param response_format: The format of the transcript output, in one of these options: json, text, srt, verbose_json, or vtt.
        :param temperature: The sampling temperature, between 0 and 1. Higher values like 0.8 will make the output more random, while lower values like 0.2 will make it more focused and deterministic. If set to 0, the model will use log probability to automatically increase the temperature until certain thresholds are hit.
        :return: text for given audio file
        """
        # transform credentials to kwargs for model instance
        credentials_kwargs = self._to_credential_kwargs(credentials)

        # init model client
        client = OpenAI(**credentials_kwargs)

        response = client.audio.transcriptions.create(model=model, file=file, language=language, prompt=prompt, response_format=response_format, temperature=temperature)

        return response.text
