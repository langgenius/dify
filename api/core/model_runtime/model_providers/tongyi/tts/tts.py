import threading
from queue import Queue
from typing import Optional

import dashscope
from dashscope import SpeechSynthesizer
from dashscope.api_entities.dashscope_response import SpeechSynthesisResponse
from dashscope.audio.tts import ResultCallback, SpeechSynthesisResult

from core.model_runtime.errors.invoke import InvokeBadRequestError
from core.model_runtime.errors.validate import CredentialsValidateFailedError
from core.model_runtime.model_providers.__base.tts_model import TTSModel
from core.model_runtime.model_providers.tongyi._common import _CommonTongyi


class TongyiText2SpeechModel(_CommonTongyi, TTSModel):
    """
    Model class for Tongyi Speech to text model.
    """

    def _invoke(self, model: str, tenant_id: str, credentials: dict, content_text: str, voice: str,
                user: Optional[str] = None) -> any:
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
        if not voice or voice not in [d['value'] for d in
                                      self.get_tts_model_voices(model=model, credentials=credentials)]:
            voice = self._get_model_default_voice(model, credentials)

        return self._tts_invoke_streaming(model=model,
                                          credentials=credentials,
                                          content_text=content_text,
                                          voice=voice)

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
                content_text='Hello Dify!',
                voice=self._get_model_default_voice(model, credentials),
            )
        except Exception as ex:
            raise CredentialsValidateFailedError(str(ex))

    def _tts_invoke_streaming(self, model: str, credentials: dict, content_text: str,
                              voice: str) -> any:
        """
        _tts_invoke_streaming text2speech model

        :param model: model name
        :param credentials: model credentials
        :param voice: model timbre
        :param content_text: text content to be translated
        :return: text translated to audio file
        """
        word_limit = self._get_model_word_limit(model, credentials)
        audio_type = self._get_model_audio_type(model, credentials)
        try:
            audio_queue: Queue = Queue()
            callback = Callback(queue=audio_queue)

            def invoke_remote(content, v, api_key, cb, at, wl):
                if len(content) < word_limit:
                    sentences = [content]
                else:
                    sentences = list(self._split_text_into_sentences(org_text=content, max_length=wl))
                for sentence in sentences:
                    SpeechSynthesizer.call(model=v, sample_rate=16000,
                                           api_key=api_key,
                                           text=sentence.strip(),
                                           callback=cb,
                                           format=at, word_timestamp_enabled=True,
                                           phoneme_timestamp_enabled=True)

            threading.Thread(target=invoke_remote, args=(
                content_text, voice, credentials.get('dashscope_api_key'), callback, audio_type, word_limit)).start()

            while True:
                audio = audio_queue.get()
                if audio is None:
                    break
                yield audio

        except Exception as ex:
            raise InvokeBadRequestError(str(ex))

    @staticmethod
    def _process_sentence(sentence: str, credentials: dict, voice: str, audio_type: str):
        """
        _tts_invoke Tongyi text2speech model api

        :param credentials: model credentials
        :param sentence: text content to be translated
        :param voice: model timbre
        :param audio_type: audio file type
        :return: text translated to audio file
        """
        response = dashscope.audio.tts.SpeechSynthesizer.call(model=voice, sample_rate=48000,
                                                              api_key=credentials.get('dashscope_api_key'),
                                                              text=sentence.strip(),
                                                              format=audio_type)
        if isinstance(response.get_audio_data(), bytes):
            return response.get_audio_data()


class Callback(ResultCallback):

    def __init__(self, queue: Queue):
        self._queue = queue

    def on_open(self):
        pass

    def on_complete(self):
        self._queue.put(None)
        self._queue.task_done()

    def on_error(self, response: SpeechSynthesisResponse):
        self._queue.put(None)
        self._queue.task_done()

    def on_close(self):
        self._queue.put(None)
        self._queue.task_done()

    def on_event(self, result: SpeechSynthesisResult):
        ad = result.get_audio_frame()
        if ad:
            self._queue.put(ad)
