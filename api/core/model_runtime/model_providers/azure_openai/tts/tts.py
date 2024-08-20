import concurrent.futures
import copy
from typing import Optional

from openai import AzureOpenAI

from core.model_runtime.entities.model_entities import AIModelEntity
from core.model_runtime.errors.invoke import InvokeBadRequestError
from core.model_runtime.errors.validate import CredentialsValidateFailedError
from core.model_runtime.model_providers.__base.tts_model import TTSModel
from core.model_runtime.model_providers.azure_openai._common import _CommonAzureOpenAI
from core.model_runtime.model_providers.azure_openai._constant import TTS_BASE_MODELS, AzureBaseModel


class AzureOpenAIText2SpeechModel(_CommonAzureOpenAI, TTSModel):
    """
    Model class for OpenAI Speech to text model.
    """

    def _invoke(self, model: str, tenant_id: str, credentials: dict,
                content_text: str, voice: str, user: Optional[str] = None) -> any:
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
        if not voice or voice not in [d['value'] for d in self.get_tts_model_voices(model=model, credentials=credentials)]:
            voice = self._get_model_default_voice(model, credentials)

        return self._tts_invoke_streaming(model=model,
                                          credentials=credentials,
                                          content_text=content_text,
                                          voice=voice)

    def validate_credentials(self, model: str, credentials: dict) -> None:
        """
        validate credentials text2speech model

        :param model: model name
        :param credentials: model credentials
        :return: text translated to audio file
        """
        try:
            self._tts_invoke_streaming(
                model=model,
                credentials=credentials,
                content_text='Hello Dify!',
                voice=self._get_model_default_voice(model, credentials),
            )
        except Exception as ex:
            raise CredentialsValidateFailedError(str(ex))

    def _tts_invoke_streaming(self, model: str,  credentials: dict, content_text: str,
                              voice: str) -> any:
        """
        _tts_invoke_streaming text2speech model
        :param model: model name
        :param credentials: model credentials
        :param content_text: text content to be translated
        :param voice: model timbre
        :return: text translated to audio file
        """
        try:
            # doc: https://platform.openai.com/docs/guides/text-to-speech
            credentials_kwargs = self._to_credential_kwargs(credentials)
            client = AzureOpenAI(**credentials_kwargs)
            # max length is 4096 characters, there is 3500 limit for each request
            max_length = 3500
            if len(content_text) > max_length:
                sentences = self._split_text_into_sentences(content_text, max_length=max_length)
                executor = concurrent.futures.ThreadPoolExecutor(max_workers=min(3, len(sentences)))
                futures = [executor.submit(client.audio.speech.with_streaming_response.create, model=model,
                                           response_format="mp3",
                                           input=sentences[i], voice=voice) for i in range(len(sentences))]
                for index, future in enumerate(futures):
                    yield from future.result().__enter__().iter_bytes(1024)

            else:
                response = client.audio.speech.with_streaming_response.create(model=model, voice=voice,
                                                                              response_format="mp3",
                                                                              input=content_text.strip())

                yield from response.__enter__().iter_bytes(1024)
        except Exception as ex:
            raise InvokeBadRequestError(str(ex))

    def _process_sentence(self, sentence: str, model: str,
                          voice, credentials: dict):
        """
        _tts_invoke openai text2speech model api

        :param model: model name
        :param credentials: model credentials
        :param voice: model timbre
        :param sentence: text content to be translated
        :return: text translated to audio file
        """
        credentials_kwargs = self._to_credential_kwargs(credentials)
        client = AzureOpenAI(**credentials_kwargs)
        response = client.audio.speech.create(model=model, voice=voice, input=sentence.strip())
        if isinstance(response.read(), bytes):
            return response.read()

    def get_customizable_model_schema(self, model: str, credentials: dict) -> Optional[AIModelEntity]:
        ai_model_entity = self._get_ai_model_entity(credentials['base_model_name'], model)
        return ai_model_entity.entity


    @staticmethod
    def _get_ai_model_entity(base_model_name: str, model: str) -> AzureBaseModel | None:
        for ai_model_entity in TTS_BASE_MODELS:
            if ai_model_entity.base_model_name == base_model_name:
                ai_model_entity_copy = copy.deepcopy(ai_model_entity)
                ai_model_entity_copy.entity.model = model
                ai_model_entity_copy.entity.label.en_US = model
                ai_model_entity_copy.entity.label.zh_Hans = model
                return ai_model_entity_copy
        return None
