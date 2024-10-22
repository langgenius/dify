from typing import IO, Optional

from xinference_client.client.restful.restful_client import Client, RESTfulAudioModelHandle

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
from core.model_runtime.model_providers.xinference.xinference_helper import validate_model_uid


class XinferenceSpeech2TextModel(Speech2TextModel):
    """
    Model class for Xinference speech to text model.
    """

    def _invoke(self, model: str, credentials: dict, file: IO[bytes], user: Optional[str] = None) -> str:
        """
        Invoke speech2text model

        :param model: model name
        :param credentials: model credentials
        :param file: audio file
        :param user: unique user id
        :return: text for given audio file
        """
        return self._speech2text_invoke(model, credentials, file)

    def validate_credentials(self, model: str, credentials: dict) -> None:
        """
        Validate model credentials

        :param model: model name
        :param credentials: model credentials
        :return:
        """
        try:
            if not validate_model_uid(credentials):
                raise CredentialsValidateFailedError("model_uid should not contain /, ?, or #")

            credentials["server_url"] = credentials["server_url"].removesuffix("/")

            # initialize client
            client = Client(
                base_url=credentials["server_url"],
                api_key=credentials.get("api_key"),
            )

            xinference_client = client.get_model(model_uid=credentials["model_uid"])

            if not isinstance(xinference_client, RESTfulAudioModelHandle):
                raise InvokeBadRequestError(
                    "please check model type, the model you want to invoke is not a audio model"
                )

            audio_file_path = self._get_demo_file_path()

            with open(audio_file_path, "rb") as audio_file:
                self.invoke(model, credentials, audio_file)
        except Exception as ex:
            raise CredentialsValidateFailedError(str(ex))

    @property
    def _invoke_error_mapping(self) -> dict[type[InvokeError], list[type[Exception]]]:
        """
        Map model invoke error to unified error
        The key is the error type thrown to the caller
        The value is the error type thrown by the model,
        which needs to be converted into a unified error type for the caller.

        :return: Invoke error mapping
        """
        return {
            InvokeConnectionError: [InvokeConnectionError],
            InvokeServerUnavailableError: [InvokeServerUnavailableError],
            InvokeRateLimitError: [InvokeRateLimitError],
            InvokeAuthorizationError: [InvokeAuthorizationError],
            InvokeBadRequestError: [InvokeBadRequestError, KeyError, ValueError],
        }

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
        :param file: The audio file object (not file name) to transcribe, in one of these formats: flac, mp3, mp4, mpeg,
          mpga, m4a, ogg, wav, or webm.
        :param language: The language of the input audio. Supplying the input language in ISO-639-1
        :param prompt: An optional text to guide the model's style or continue a previous audio segment.
            The prompt should match the audio language.
        :param response_format: The format of the transcript output, in one of these options: json, text, srt,
          verbose_json, or vtt.
        :param temperature: The sampling temperature, between 0 and 1. Higher values like 0.8 will make the output more
          random,while lower values like 0.2 will make it more focused and deterministic.If set to 0, the model will use
          log probability to automatically increase the temperature until certain thresholds are hit.
        :return: text for given audio file
        """
        server_url = credentials["server_url"]
        model_uid = credentials["model_uid"]
        api_key = credentials.get("api_key")
        server_url = server_url.removesuffix("/")
        auth_headers = {"Authorization": f"Bearer {api_key}"} if api_key else {}

        try:
            handle = RESTfulAudioModelHandle(model_uid, server_url, auth_headers)
            response = handle.transcriptions(
                audio=file, language=language, prompt=prompt, response_format=response_format, temperature=temperature
            )
        except RuntimeError as e:
            raise InvokeServerUnavailableError(str(e))

        return response["text"]

    def get_customizable_model_schema(self, model: str, credentials: dict) -> Optional[AIModelEntity]:
        """
        used to define customizable model schema
        """
        entity = AIModelEntity(
            model=model,
            label=I18nObject(en_US=model),
            fetch_from=FetchFrom.CUSTOMIZABLE_MODEL,
            model_type=ModelType.SPEECH2TEXT,
            model_properties={},
            parameter_rules=[],
        )

        return entity
