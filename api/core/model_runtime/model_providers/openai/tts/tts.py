import concurrent.futures
from functools import reduce
from io import BytesIO
from typing import Optional

from flask import Response, stream_with_context
from openai import OpenAI
from pydub import AudioSegment

from core.model_runtime.errors.invoke import InvokeBadRequestError
from core.model_runtime.errors.validate import CredentialsValidateFailedError
from core.model_runtime.model_providers.__base.tts_model import TTSModel
from core.model_runtime.model_providers.openai._common import _CommonOpenAI
from extensions.ext_storage import storage


class OpenAIText2SpeechModel(_CommonOpenAI, TTSModel):
    """
    Model class for OpenAI Speech to text model.
    """

    def _invoke(self, model: str, tenant_id: str, credentials: dict,
                content_text: str, voice: str, streaming: bool, user: Optional[str] = None) -> any:
        """
        _invoke text2speech model

        :param model: model name
        :param tenant_id: user tenant id
        :param credentials: model credentials
        :param content_text: text content to be translated
        :param voice: model timbre
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
                                                                           tenant_id=tenant_id,
                                                                           voice=voice)),
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
        :param content_text: text content to be translated
        :param voice: model timbre
        :return: text translated to audio file
        """
        audio_type = self._get_model_audio_type(model, credentials)
        word_limit = self._get_model_word_limit(model, credentials)
        max_workers = self._get_model_workers_limit(model, credentials)
        try:
            sentences = list(self._split_text_into_sentences(text=content_text, limit=word_limit))
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

    # Todo: To improve the streaming function
    def _tts_invoke_streaming(self, model: str, tenant_id: str, credentials: dict, content_text: str,
                              voice: str) -> any:
        """
        _tts_invoke_streaming text2speech model

        :param model: model name
        :param tenant_id: user tenant id
        :param credentials: model credentials
        :param content_text: text content to be translated
        :param voice: model timbre
        :return: text translated to audio file
        """
        # transform credentials to kwargs for model instance
        credentials_kwargs = self._to_credential_kwargs(credentials)
        if not voice or voice not in self.get_tts_model_voices(model=model, credentials=credentials):
            voice = self._get_model_default_voice(model, credentials)
        word_limit = self._get_model_word_limit(model, credentials)
        audio_type = self._get_model_audio_type(model, credentials)
        tts_file_id = self._get_file_name(content_text)
        file_path = f'generate_files/audio/{tenant_id}/{tts_file_id}.{audio_type}'
        try:
            client = OpenAI(**credentials_kwargs)
            sentences = list(self._split_text_into_sentences(text=content_text, limit=word_limit))
            for sentence in sentences:
                response = client.audio.speech.create(model=model, voice=voice, input=sentence.strip())
                # response.stream_to_file(file_path)
                storage.save(file_path, response.read())
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
        client = OpenAI(**credentials_kwargs)
        response = client.audio.speech.create(model=model, voice=voice, input=sentence.strip())
        if isinstance(response.read(), bytes):
            return response.read()
