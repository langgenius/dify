import concurrent.futures
from functools import reduce
from io import BytesIO
from typing import Optional

from flask import Response
from pydub import AudioSegment
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
from core.model_runtime.model_providers.__base.tts_model import TTSModel


class XinferenceText2SpeechModel(TTSModel):

    def __init__(self):
        # preset voices, need support custom voice
        self.model_voices = {
            'chattts': {
                'all': [
                    {'name': 'Alloy', 'value': 'alloy'},
                    {'name': 'Echo', 'value': 'echo'},
                    {'name': 'Fable', 'value': 'fable'},
                    {'name': 'Onyx', 'value': 'onyx'},
                    {'name': 'Nova', 'value': 'nova'},
                    {'name': 'Shimmer', 'value': 'shimmer'},
                ]
            },
            'cosyvoice': {
                'zh-Hans': [
                    {'name': '中文男', 'value': '中文男'},
                    {'name': '中文女', 'value': '中文女'},
                    {'name': '粤语女', 'value': '粤语女'},
                ],
                'zh-Hant': [
                    {'name': '中文男', 'value': '中文男'},
                    {'name': '中文女', 'value': '中文女'},
                    {'name': '粤语女', 'value': '粤语女'},
                ],
                'en-US': [
                    {'name': '英文男', 'value': '英文男'},
                    {'name': '英文女', 'value': '英文女'},
                ],
                'ja-JP': [
                    {'name': '日语男', 'value': '日语男'},
                ],
                'ko-KR': [
                    {'name': '韩语女', 'value': '韩语女'},
                ]
            }
        }

    def validate_credentials(self, model: str, credentials: dict) -> None:
        """
                Validate model credentials

                :param model: model name
                :param credentials: model credentials
                :return:
                """
        try:
            if ("/" in credentials['model_uid'] or
                    "?" in credentials['model_uid'] or
                    "#" in credentials['model_uid']):
                raise CredentialsValidateFailedError("model_uid should not contain /, ?, or #")

            if credentials['server_url'].endswith('/'):
                credentials['server_url'] = credentials['server_url'][:-1]

            # initialize client
            client = Client(
                base_url=credentials['server_url']
            )

            xinference_client = client.get_model(model_uid=credentials['model_uid'])

            if not isinstance(xinference_client, RESTfulAudioModelHandle):
                raise InvokeBadRequestError(
                    'please check model type, the model you want to invoke is not a audio model')

            self._tts_invoke(
                model=model,
                credentials=credentials,
                content_text='Hello Dify!',
                voice=self._get_model_default_voice(model, credentials),
            )
        except Exception as ex:
            raise CredentialsValidateFailedError(str(ex))

    def _invoke(self, model: str, tenant_id: str, credentials: dict, content_text: str, voice: str,
                user: Optional[str] = None):
        """
        _invoke text2speech model

        :param model: model name
        :param tenant_id: user tenant id
        :param credentials: model credentials
        :param voice: model timbre
        :param content_text: text content to be translated
        :param user: unique user id
        :return: text translated to audio file
        """
        return self._tts_invoke(model, credentials, content_text, voice)

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
            model_type=ModelType.TTS,
            model_properties={},
            parameter_rules=[]
        )

        return entity

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
                InvokeBadRequestError,
                KeyError,
                ValueError
            ]
        }

    def get_tts_model_voices(self, model: str, credentials: dict, language: Optional[str] = None) -> list:
        for key, voices in self.model_voices.items():
            if key in model.lower():
                if language in voices:
                    return voices[language]
                elif 'all' in voices:
                    return voices['all']
        return []

    def _get_model_default_voice(self, model: str, credentials: dict) -> any:
        return ""

    def _get_model_word_limit(self, model: str, credentials: dict) -> int:
        return 3500

    def _get_model_audio_type(self, model: str, credentials: dict) -> str:
        return "mp3"

    def _get_model_workers_limit(self, model: str, credentials: dict) -> int:
        return 5

    def _tts_invoke(self, model: str, credentials: dict, content_text: str, voice: str) -> any:
        """
        _tts_invoke text2speech model

        :param model: model name
        :param credentials: model credentials
        :param voice: model timbre
        :param content_text: text content to be translated
        :return: text translated to audio file
        """
        if credentials['server_url'].endswith('/'):
            credentials['server_url'] = credentials['server_url'][:-1]

        word_limit = self._get_model_word_limit(model, credentials)
        audio_type = self._get_model_audio_type(model, credentials)
        handle = RESTfulAudioModelHandle(credentials['model_uid'], credentials['server_url'], auth_headers={})

        try:
            sentences = list(self._split_text_into_sentences(org_text=content_text, max_length=word_limit))
            audio_bytes_list = []

            with concurrent.futures.ThreadPoolExecutor(max_workers=min((3, len(sentences)))) as executor:
                futures = [executor.submit(
                    handle.speech, input=sentence, voice=voice, response_format="mp3", speed=1.0, stream=False)
                    for sentence in sentences]
            for future in futures:
                try:
                    if future.result():
                        audio_bytes_list.append(future.result())
                except Exception as ex:
                    raise InvokeBadRequestError(str(ex))

            if len(audio_bytes_list) > 0:
                audio_segments = [AudioSegment.from_file(
                    BytesIO(audio_bytes), format=audio_type) for audio_bytes in
                    audio_bytes_list if audio_bytes]
                combined_segment = reduce(lambda x, y: x + y, audio_segments)
                buffer: BytesIO = BytesIO()
                combined_segment.export(buffer, format=audio_type)
                buffer.seek(0)
                return Response(buffer.read(), status=200, mimetype=f"audio/{audio_type}")
        except Exception as ex:
            raise InvokeBadRequestError(str(ex))

    def _tts_invoke_streaming(self, model: str, credentials: dict, content_text: str, voice: str) -> any:
        """
        _tts_invoke_streaming text2speech model

        Attention:  stream api may return error [Parallel generation is not supported by ggml]

        :param model: model name
        :param credentials: model credentials
        :param voice: model timbre
        :param content_text: text content to be translated
        :return: text translated to audio file
        """
        pass
