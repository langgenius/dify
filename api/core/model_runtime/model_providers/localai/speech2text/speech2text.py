from typing import IO, Optional

from requests import Request, Session
from yarl import URL

from core.model_runtime.entities.common_entities import I18nObject
from core.model_runtime.entities.model_entities import AIModelEntity, FetchFrom, ModelType
from core.model_runtime.errors.invoke import (
    InvokeAuthorizationError,
    InvokeBadRequestError,
    InvokeConnectionError,
    InvokeError,
    InvokeRateLimitError,
    InvokeServerUnavailableError,
)
from core.model_runtime.errors.validate import CredentialsValidateFailedError
from core.model_runtime.model_providers.__base.speech2text_model import Speech2TextModel


class LocalAISpeech2text(Speech2TextModel):
    """
    Model class for Local AI Text to speech model.
    """

    def _invoke(self, model: str, credentials: dict, file: IO[bytes], user: Optional[str] = None, language: Optional[str] = None, prompt: Optional[str] = None, response_format: Optional[str] = 'json', temperature: Optional[float] = 0 ) -> str:
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
        
        url = str(URL(credentials['server_url']) / "v1/audio/transcriptions")
        data = {"model": model}
        data = {"language": language}
        data = {"prompt": prompt}
        data = {"response_format": response_format}
        data = {"temperature": temperature}

        files = {"file": file}

        session = Session()
        request = Request("POST", url, data=data, files=files)
        prepared_request = session.prepare_request(request)
        response = session.send(prepared_request)

        if 'error' in response.json():
            raise InvokeServerUnavailableError("Empty response")

        return response.json()["text"]

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
                self._invoke(model, credentials, audio_file)
        except Exception as ex:
            raise CredentialsValidateFailedError(str(ex))

    @property
    def _invoke_error_mapping(self) -> dict[type[InvokeError], list[type[Exception]]]:
        return {
            InvokeConnectionError: [
                InvokeConnectionError
            ],
            InvokeServerUnavailableError: [
                InvokeServerUnavailableError
            ],
            InvokeRateLimitError: [
                InvokeRateLimitError
            ],
            InvokeAuthorizationError: [
                InvokeAuthorizationError
            ],
            InvokeBadRequestError: [
                InvokeBadRequestError
            ],
        }

    def get_customizable_model_schema(self, model: str, credentials: dict) -> AIModelEntity | None:
        """
            used to define customizable model schema
        """
        entity = AIModelEntity(
            model=model,
            label=I18nObject(
                en_US=model
            ),
            fetch_from=FetchFrom.CUSTOMIZABLE_MODEL,
            model_type=ModelType.SPEECH2TEXT,
            model_properties={},
            parameter_rules=[]
        )

        return entity