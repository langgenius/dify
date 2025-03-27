import concurrent.futures
from typing import Any, Mapping, Optional
from dify_plugin.interfaces.model.openai_compatible.common import _CommonOaiApiCompat
from httpx import Timeout
from dify_plugin.errors.model import (
    CredentialsValidateFailedError,
    InvokeBadRequestError,
)
from dify_plugin.interfaces.model.tts_model import TTSModel
from openai import OpenAI


class SiliconFlowText2SpeechModel(_CommonOaiApiCompat, TTSModel):
    """
    Model class for SiliconFlow Speech to text model.
    """

    def _invoke(
        self,
        model: str,
        tenant_id: str,
        credentials: dict,
        content_text: str,
        voice: str,
        user: Optional[str] = None,
    ) -> Any:
        """
        _invoke text2speech model

        :param model: model name
        :param tenant_id: user tenant id
        :param credentials: model credentials
        :param content_text: text content to be translated
        :param voice: model timbre
        :param user: unique user id
        :return: text translated to audio file
        """
        voices = self.get_tts_model_voices(model=model, credentials=credentials) or []
        if not voice or voice not in [d["value"] for d in voices]:
            voice = self._get_model_default_voice(model, credentials)
        return self._tts_invoke_streaming(
            model=model, credentials=credentials, content_text=content_text, voice=voice
        )

    def validate_credentials(self, model: str, credentials: Mapping) -> None:
        """
        validate credentials text2speech model

        :param model: model name
        :param credentials: model credentials
        :param user: unique user id
        :return: text translated to audio file
        """
        try:
            self._tts_invoke_streaming(
                model=model,
                credentials=credentials,
                content_text="Hello SiliconFlow!",
                voice=self._get_model_default_voice(model, credentials),
            )
        except Exception as ex:
            raise CredentialsValidateFailedError(str(ex))

    def _tts_invoke_streaming(
        self, model: str, credentials: Mapping, content_text: str, voice: str
    ) -> Any:
        """
        _tts_invoke_streaming text2speech model

        :param model: model name
        :param credentials: model credentials
        :param content_text: text content to be translated
        :param voice: model timbre
        :return: text translated to audio file
        """
        credentials = dict(credentials)
        try:
            self._add_custom_parameters(credentials)
            credentials_kwargs = self._to_credential_kwargs(credentials)
            client = OpenAI(**credentials_kwargs)
            voices = (
                self.get_tts_model_voices(model=model, credentials=credentials) or []
            )
            model_support_voice = [x.get("value") for x in voices]
            if not voice or voice not in model_support_voice:
                voice = self._get_model_default_voice(model, credentials)
            if len(content_text) > 4096:
                sentences = self._split_text_into_sentences(
                    content_text, max_length=4096
                )
                executor = concurrent.futures.ThreadPoolExecutor(
                    max_workers=min(3, len(sentences))
                )
                futures = [
                    executor.submit(
                        client.audio.speech.with_streaming_response.create,
                        model=model,
                        response_format="mp3",
                        input=sentences[i],
                        voice=voice,
                    )
                    for i in range(len(sentences))
                ]
                for future in futures:
                    yield from future.result().__enter__().iter_bytes(1024)
            else:
                response = client.audio.speech.with_streaming_response.create(
                    model=model,
                    voice=voice,
                    response_format="mp3",
                    input=content_text.strip(),
                )
                yield from response.__enter__().iter_bytes(1024)
        except Exception as ex:
            raise InvokeBadRequestError(str(ex))

    @classmethod
    def _add_custom_parameters(cls, credentials: dict) -> None:
        credentials["openai_api_base"] = "https://api.siliconflow.cn"
        credentials["openai_api_key"] = credentials["api_key"]

    def _to_credential_kwargs(self, credentials: Mapping) -> dict:
        """
        Transform credentials to kwargs for model instance

        :param credentials:
        :return:
        """
        credentials_kwargs = {
            "api_key": credentials["openai_api_key"],
            "timeout": Timeout(315.0, read=300.0, write=10.0, connect=5.0),
            "max_retries": 1,
        }

        if credentials.get("openai_api_base"):
            openai_api_base = credentials["openai_api_base"].rstrip("/")
            credentials_kwargs["base_url"] = openai_api_base + "/v1"

        if "openai_organization" in credentials:
            credentials_kwargs["organization"] = credentials["openai_organization"]

        return credentials_kwargs
