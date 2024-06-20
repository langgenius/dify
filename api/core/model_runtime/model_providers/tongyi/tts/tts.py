import _thread
from functools import reduce
from io import BytesIO
from queue import Queue
from typing import Optional

from dashscope.api_entities.dashscope_response import SpeechSynthesisResponse
from dashscope.audio.tts import ResultCallback, SpeechSynthesisResult, SpeechSynthesizer
from flask import Response, stream_with_context
from pydub import AudioSegment

from core.model_runtime.errors.invoke import InvokeBadRequestError
from core.model_runtime.errors.validate import CredentialsValidateFailedError
from core.model_runtime.model_providers.__base.tts_model import TTSModel
from core.model_runtime.model_providers.tongyi._common import _CommonTongyi
from extensions.ext_storage import storage


class TongyiText2SpeechModel(_CommonTongyi, TTSModel):
    """
    Model class for Tongyi Speech to text model.
    """

    def _invoke(
        self,
        model: str,
        tenant_id: str,
        credentials: dict,
        content_text: str,
        voice: str,
        streaming: bool,
        user: Optional[str] = None,
    ) -> any:
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
        if not voice or voice not in [
            d["value"] for d in self.get_tts_model_voices(model=model, credentials=credentials)
        ]:
            voice = self._get_model_default_voice(model, credentials)
        if streaming:
            return Response(
                stream_with_context(
                    self._tts_invoke_streaming(
                        model=model,
                        credentials=credentials,
                        content_text=content_text,
                        voice=voice,
                        tenant_id=tenant_id,
                    )
                ),
                status=200,
                mimetype=f"audio/{audio_type}",
            )
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
                content_text="Hello Dify!",
                voice=self._get_model_default_voice(model, credentials),
            )
        except Exception as ex:
            raise CredentialsValidateFailedError(str(ex))
        
    
    def _combine_audio_segment(self,audio_segments: list, audio_type: str) -> BytesIO:
        if len(audio_segments)>0:
            combined_segment = reduce(lambda x, y: x + y, audio_segments)
            buffer: BytesIO = BytesIO()
            combined_segment.export(buffer, format=audio_type)
            buffer.seek(0)
            return buffer


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
        try:
            sentences = list(self._split_text_into_sentences(text=content_text, limit=word_limit))
            audio_segments = list()
            for sentence in sentences:
                audio_bytes = self._process_sentence(
                        sentence=sentence,
                        credentials=credentials,
                        voice=voice,
                        audio_type=audio_type,
                    )
                if audio_bytes is not None:
                    audio_segments.append(AudioSegment.from_file(BytesIO(audio_bytes), format=audio_type))

            buffer = self._combine_audio_segment(audio_segments,audio_type)
            if buffer is not None:
                return Response(buffer.read(), status=200, mimetype=f"audio/{audio_type}")
        except Exception as ex:
            raise InvokeBadRequestError(str(ex))

    # Todo: To improve the streaming function
    def _tts_invoke_streaming(
        self, model: str, tenant_id: str, credentials: dict, content_text: str, voice: str
    ) -> any:
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
        file_path = f"generate_files/audio/{tenant_id}/{tts_file_id}.{audio_type}"
       # The queue of audio binary data
        queue = Queue()
        job_done = CallbackStatus()
        job_error = CallbackStatus()
        job_completed = CallbackStatus()
        # A callback that returns speech synthesis results.
        callback = Callback(queue,job_done,job_error)

        try:
            sentences = list(self._split_text_into_sentences(text=content_text, limit=word_limit))
            _thread.start_new_thread(self._tts_invoke_streaming_call,(
                                sentences,
                                voice,
                                audio_type,
                                callback,
                                credentials,
                                file_path,
                                queue,
                                job_completed
            ))
            while True:
                item = queue.get(True, 300)
                if item is job_done:
                    continue
                if item is job_completed:
                    break
                elif item is job_error:
                    raise InvokeBadRequestError(str(item.messages))
                else:
                    yield item

        except Exception as ex:
            raise InvokeBadRequestError(str(ex))

    def _tts_invoke_streaming_call(
        self, sentences: list[str], 
        voice: str, 
        audio_type: str, 
        callback: any, 
        credentials: dict, 
        file_path: str,
        queue: Queue,
        job_completed: any
    ):
        results =  [
                self._process_sentence(
                    sentence=sentence.strip(),
                    credentials=credentials,
                    voice=voice,
                    audio_type=audio_type,
                    callback=callback,
                    word_timestamp_enabled=True,
                    phoneme_timestamp_enabled=True)
                for sentence in sentences
        ]
        if len(results) > 0:
            audio_segments = list()
            for audio_bytes in results:
                audio_segments.append(AudioSegment.from_file(BytesIO(audio_bytes), format=audio_type))

            buffer = self._combine_audio_segment(audio_segments,audio_type)
            if buffer is not None:
                storage.save(file_path, buffer.getvalue())
        queue.put(job_completed)
       
    @staticmethod
    def _process_sentence(sentence: str, 
                          credentials: dict, 
                          voice: str, 
                          audio_type: str,
                          callback: any = None,
                          word_timestamp_enabled: bool = False,
                          phoneme_timestamp_enabled: bool = False
                          ):
        """
        _tts_invoke Tongyi text2speech model api

        :param credentials: model credentials
        :param sentence: text content to be translated
        :param voice: model timbre
        :param audio_type: audio file type
        :return: text translated to audio file
        """
        
        """
        Calling the `SpeechSynthesizer.call` method in multithreading will throw a RuntimeError,
        `RuntimeError: Cannot run the event loop while another loop is running` 
        because the asyncio.run_until_complete method is called internally, 
        and the event loop will check whether there is already a thread holding the same ID.
        """
        response = SpeechSynthesizer.call(
            model=voice,
            sample_rate=48000,
            api_key=credentials.get("dashscope_api_key"),
            text=sentence.strip(),
            format=audio_type,
            callback=callback,
            word_timestamp_enabled=word_timestamp_enabled,
            phoneme_timestamp_enabled=phoneme_timestamp_enabled
        )
        if isinstance(response.get_audio_data(), bytes):
            return response.get_audio_data()


class CallbackStatus:
    def __init__(self, messages=None) -> None:
        if messages is not None:
            self._messages = messages
        else:
            self._messages = ""

    @property
    def messages(self) -> str:
        return self._messages

    @messages.setter
    def messages(self, value: str):
        self._messages = value


class Callback(ResultCallback):
    def __init__(self, queue: Queue, job_done: CallbackStatus, job_error: CallbackStatus) -> None:
        super().__init__()
        self._queue = queue
        self._job_done = job_done
        self._job_error = job_error

    def on_complete(self):
        self._queue.put(self._job_done)

    def on_error(self, response: SpeechSynthesisResponse):
        self._job_error.messages = str(response)
        self._queue.put(self._job_error)

    def on_event(self, result: SpeechSynthesisResult):
        
        if result.get_audio_frame() is not None:
            self._queue.put(result.get_audio_frame())
