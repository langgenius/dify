import concurrent.futures
import copy
from functools import reduce
from io import BytesIO
from typing import Optional

from flask import Response
from openai import AzureOpenAI
from pydub import AudioSegment

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
            self._tts_invoke(
                model=model,
                credentials=credentials,
                content_text='Hello Dify!',
                voice=self._get_model_default_voice(model, credentials),
            )
        except Exception as ex:
            raise CredentialsValidateFailedError(str(ex))

    def _tts_invoke(self, model: str, credentials: dict, content_text: str, voice: str) -> Response:
        """
        _tts_invoke text2speech model

        :param model: model name
        :param credentials: model credentials
        :param content_text: text content to be translated
        :param voice: model timbre
        :return: text translated to audio file
        """
        audio_type = self._get_model_audio_type(model, credentials)
        word_limit = self._get_model_word_limit(model, credentials)
        max_workers = self._get_model_workers_limit(model, credentials)
        try:
            sentences = list(self._split_text_into_sentences(org_text=content_text, max_length=word_limit))
            audio_bytes_list = []

            # Create a thread pool and map the function to the list of sentences
            with concurrent.futures.ThreadPoolExecutor(max_workers=max_workers) as executor:
                futures = [executor.submit(self._process_sentence, sentence=sentence, model=model, voice=voice,
                                           credentials=credentials) for sentence in sentences]
                for future in futures:
                    try:
                        if future.result():
                            audio_bytes_list.append(future.result())
                    except Exception as ex:
                        raise InvokeBadRequestError(str(ex))

            if len(audio_bytes_list) > 0:
                audio_segments = [AudioSegment.from_file(BytesIO(audio_bytes), format=audio_type) for audio_bytes in
                                  audio_bytes_list if audio_bytes]
                combined_segment = reduce(lambda x, y: x + y, audio_segments)
                buffer: BytesIO = BytesIO()
                combined_segment.export(buffer, format=audio_type)
                buffer.seek(0)
                return Response(buffer.read(), status=200, mimetype=f"audio/{audio_type}")
        except Exception as ex:
            raise InvokeBadRequestError(str(ex))

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
            # max font is 4096,there is 3500 limit for each request
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
        # transform credentials to kwargs for model instance
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
