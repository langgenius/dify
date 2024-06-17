import concurrent.futures
from functools import reduce
from io import BytesIO
from typing import Optional

import dashscope
from flask import Response, stream_with_context
from pydub import AudioSegment

from core.model_runtime.errors.invoke import InvokeBadRequestError
from core.model_runtime.errors.validate import CredentialsValidateFailedError
from core.model_runtime.model_providers.__base.tts_model import TTSModel
from core.model_runtime.model_providers.tongyi._common import _CommonTongyi
from extensions.ext_storage import storage
from queue import Queue
from dashscope.api_entities.dashscope_response import SpeechSynthesisResponse
from dashscope.audio.tts import ResultCallback
from dashscope.audio.tts import SpeechSynthesisResult,SpeechSynthesizer

class TongyiText2SpeechModel(_CommonTongyi, TTSModel):
    """
    Model class for Tongyi Speech to text model.
    """

    def _invoke(self, model: str, tenant_id: str, credentials: dict, content_text: str, voice: str, streaming: bool,
                user: Optional[str] = None) -> any:
        """
        _invoke text2speech model

        :param model: model name
        :param tenant_id: user tenant id
        :param credentials: model credentials
        :param voice: model timbre
        :param content_text: text content to be translated
        :param streaming: output is streaming
        :param user: unique user id
        :return: text translated to audio file
        """
        audio_type = self._get_model_audio_type(model, credentials)
        if not voice or voice not in [d['value'] for d in self.get_tts_model_voices(model=model, credentials=credentials)]:
            voice = self._get_model_default_voice(model, credentials)
        if streaming:
            return Response(stream_with_context(self._tts_invoke_streaming(model=model,
                                                                           credentials=credentials,
                                                                           content_text=content_text,
                                                                           voice=voice,
                                                                           tenant_id=tenant_id)),
                            status=200, mimetype=f'audio/{audio_type}')
        else:
            return self._tts_invoke(model=model, credentials=credentials, content_text=content_text, voice=voice)

    def validate_credentials(self, model: str, credentials: dict, user: Optional[str] = None) -> None:
        """
        validate credentials text2speech model

        :param model: model name
        :param credentials: model credentials
        :param user: unique user id
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
        :param voice: model timbre
        :param content_text: text content to be translated
        :return: text translated to audio file
        """
        audio_type = self._get_model_audio_type(model, credentials)
        word_limit = self._get_model_word_limit(model, credentials)
        max_workers = self._get_model_workers_limit(model, credentials)
        try:
            sentences = list(self._split_text_into_sentences(text=content_text, limit=word_limit))
            audio_bytes_list = list()

            # Create a thread pool and map the function to the list of sentences
            with concurrent.futures.ThreadPoolExecutor(max_workers=max_workers) as executor:
                futures = [executor.submit(self._process_sentence, sentence=sentence,
                                           credentials=credentials, voice=voice, audio_type=audio_type) for sentence in
                           sentences]
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

    # Todo: To improve the streaming function
    def _tts_invoke_streaming(self, model: str, tenant_id: str, credentials: dict, content_text: str,
                              voice: str) -> any:
        """
        _tts_invoke_streaming text2speech model

        :param model: model name
        :param tenant_id: user tenant id
        :param credentials: model credentials
        :param voice: model timbre
        :param content_text: text content to be translated
        :return: text translated to audio file
        """
        word_limit = self._get_model_word_limit(model, credentials)
        audio_type = self._get_model_audio_type(model, credentials)
        tts_file_id = self._get_file_name(content_text)
        file_path = f'generate_files/audio/{tenant_id}/{tts_file_id}.{audio_type}'
        max_workers = self._get_model_workers_limit(model, credentials)

        # The queue of audio binary data
        queue = Queue()
        job_done = CallbackStatus()
        job_error = CallbackStatus()
        # A callback that returns speech synthesis results.
        callback = Callback(queue,job_done,job_error)

        try:
            sentences = list(self._split_text_into_sentences(text=content_text, limit=word_limit))
            with concurrent.futures.ThreadPoolExecutor(max_workers=max_workers) as executor:
                [executor.submit(self._tts_invoke_streaming_call,
                                sentence=sentence,
                                voice=voice,
                                audio_type=audio_type,
                                callback=callback,
                                credentials=credentials,
                                file_path=file_path
                                ) for sentence in sentences]

            while True:
                item = queue.get(True,15)
                if item is job_done:
                    break
                elif item is job_error:
                    raise InvokeBadRequestError(str(item.messages))
                else:
                    yield item

        except Exception as ex:
            raise InvokeBadRequestError(str(ex))
        
    
    def _tts_invoke_streaming_call(self, sentence:str, 
                                   voice:str, 
                                   audio_type: str, 
                                   callback: any,
                                   credentials: dict,
                                   file_path: str
                                   ): 
        
        response = SpeechSynthesizer.call(model=voice, sample_rate=48000,
                                api_key=credentials.get('dashscope_api_key'),
                                text=sentence.strip(),
                                callback=callback,
                                format=audio_type, word_timestamp_enabled=True,
                                phoneme_timestamp_enabled=True)
        if isinstance(response.get_audio_data(), bytes):
            storage.save(file_path,response.get_audio_data())
        


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

class CallbackStatus():
    def __init__(self, messages=None) -> None:
        if messages is not None:
            self._messages = messages
        else:
            self._messages=''

    @property
    def messages(self) -> str:
        return self._messages

    @messages.setter
    def messages(self, value: str):
        self._messages = value
    
class Callback(ResultCallback):

    def __init__(self,queue: Queue,job_done: CallbackStatus, job_error: CallbackStatus) -> None:
        super().__init__()
        self._queue = queue
        self._job_done= job_done
        self._job_error= job_error

    def on_complete(self):
        self._queue.put(self._job_done)

    def on_error(self, response: SpeechSynthesisResponse):
        self._job_error.messages = (str(response))
        self._queue.put(self._job_error)

    def on_event(self, result: SpeechSynthesisResult):
        if result.get_audio_frame() is not None:
            self._queue.put(result.get_audio_frame())