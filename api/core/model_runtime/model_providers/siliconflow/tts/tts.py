import concurrent.futures
from typing import Any, Optional

from openai import OpenAI

from core.model_runtime.errors.invoke import InvokeBadRequestError
from core.model_runtime.errors.validate import CredentialsValidateFailedError
from core.model_runtime.model_providers.__base.tts_model import TTSModel
from core.model_runtime.model_providers.openai._common import _CommonOpenAI


class SiliconFlowText2SpeechModel(_CommonOpenAI, TTSModel):
    """
    Model class for SiliconFlow Speech to text model.
    """

    def _invoke(
        self, model: str, tenant_id: str, credentials: dict, content_text: str, voice: str, user: Optional[str] = None
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
        if not voice or voice not in [
            d["value"] for d in self.get_tts_model_voices(model=model, credentials=credentials)
        ]:
            voice = self._get_model_default_voice(model, credentials)
        # if streaming:
        return self._tts_invoke_streaming(model=model, credentials=credentials, content_text=content_text, voice=voice)

    def validate_credentials(self, model: str, credentials: dict, user: Optional[str] = None) -> None:
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

    def _tts_invoke_streaming(self, model: str, credentials: dict, content_text: str, voice: str) -> Any:
        """
        _tts_invoke_streaming text2speech model

        :param model: model name
        :param credentials: model credentials
        :param content_text: text content to be translated
        :param voice: model timbre
        :return: text translated to audio file
        """
        try:
            # doc: https://docs.siliconflow.cn/capabilities/text-to-speech
            self._add_custom_parameters(credentials)
            credentials_kwargs = self._to_credential_kwargs(credentials)
            client = OpenAI(**credentials_kwargs)
            model_support_voice = [
                x.get("value") for x in self.get_tts_model_voices(model=model, credentials=credentials)
            ]
            if not voice or voice not in model_support_voice:
                voice = self._get_model_default_voice(model, credentials)
            if len(content_text) > 4096:
                sentences = self._split_text_into_sentences(content_text, max_length=4096)
                executor = concurrent.futures.ThreadPoolExecutor(max_workers=min(3, len(sentences)))
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
                    yield from future.result().__enter__().iter_bytes(1024)  # noqa:PLC2801

            else:
                response = client.audio.speech.with_streaming_response.create(
                    model=model, voice=voice, response_format="mp3", input=content_text.strip()
                )

                yield from response.__enter__().iter_bytes(1024)  # noqa:PLC2801
        except Exception as ex:
            raise InvokeBadRequestError(str(ex))

    @classmethod
    def _add_custom_parameters(cls, credentials: dict) -> None:
        credentials["openai_api_base"] = "https://api.siliconflow.cn"
        credentials["openai_api_key"] = credentials["api_key"]
