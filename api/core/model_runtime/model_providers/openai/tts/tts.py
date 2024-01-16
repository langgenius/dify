import io
from io import BytesIO
from typing import Optional
from functools import reduce
from pydub import AudioSegment

from core.model_runtime.entities.model_entities import ModelPropertyKey
from core.model_runtime.errors.validate import CredentialsValidateFailedError
from core.model_runtime.errors.invoke import InvokeBadRequestError
from core.model_runtime.model_providers.__base.tts_model import TTSModel
from core.model_runtime.model_providers.openai._common import _CommonOpenAI

from typing_extensions import Literal
from openai import OpenAI
from flask import Response


class OpenAIText2SpeechModel(_CommonOpenAI, TTSModel):
    """
    Model class for OpenAI Speech to text model.
    """
    def _invoke(self, model: str, credentials: dict, content_text: str, user: Optional[str] = None) -> any:
        """
        Invoke text2speech model

        :param model: model name
        :param credentials: model credentials
        :param content_text: text content to be translated
        :param user: unique user id
        :return: text translated to audio file
        """
        return self._text2speech_invoke(model=model, credentials=credentials, content_text=content_text, user=user)

    def validate_credentials(self, model: str, credentials: dict, user: Optional[str] = None) -> None:
        """
        Validate text2speech model

        :param model: model name
        :param credentials: model credentials
        :param user: unique user id
        :return: text translated to audio file
        """
        try:
            self._text2speech_invoke(
                model=model,
                credentials=credentials,
                content_text='Hello world!',
                user=user
            )
        except Exception as ex:
            raise CredentialsValidateFailedError(str(ex))

    def _text2speech_invoke(self, model: str, credentials: dict, content_text: str, user: Optional[str] = None) -> any:
        """
        Invoke text2speech model

        :param model: model name
        :param credentials: model credentials
        :param content_text: text content to be translated
        :param user: unique user id
        :return: text translated to audio file
        """
        # transform credentials to kwargs for model instance
        credentials_kwargs = self._to_credential_kwargs(credentials)
        voice_name = self._get_model_voice(model, credentials)
        audio_type = self._get_model_audio_type(model, credentials)
        word_limit = self._get_model_word_limit(model, credentials)
        try:
            client = OpenAI(**credentials_kwargs)
            sentences = list(self.split_text_into_sentences(text=content_text, limit=word_limit))
            audio_bytes_list = list()
            for sentence in sentences:
                response = client.audio.speech.create(model=model, voice=voice_name, input=sentence.strip())
                if isinstance(response.read(), bytes):
                    audio_bytes_list.append(response.read())

            audio_segments = [AudioSegment.from_file(io.BytesIO(audio_bytes), format=audio_type) for audio_bytes in
                              audio_bytes_list if audio_bytes]
            combined_segment = reduce(lambda x, y: x + y, audio_segments)
            buffer: BytesIO = io.BytesIO()
            combined_segment.export(buffer, format=audio_type)
            buffer.seek(0)
            return Response(buffer.read(), mimetype=f"audio/{audio_type}")
        except Exception as ex:
            raise InvokeBadRequestError(str(ex))

    def _get_model_voice(self, model: str, credentials: dict) -> Literal["alloy", "echo", "fable", "onyx", "nova", "shimmer"]:
        """
        Get voice for given tts model

        :param model: model name
        :param credentials: model credentials
        :return: voice
        """
        model_schema = self.get_model_schema(model, credentials)

        if model_schema and ModelPropertyKey.DEFAULT_VOICE in model_schema.model_properties:
            return model_schema.model_properties[ModelPropertyKey.DEFAULT_VOICE]

    def _get_model_audio_type(self, model: str, credentials: dict) -> str:
        """
        Get audio type for given tts model

        :param model: model name
        :param credentials: model credentials
        :return: voice
        """
        model_schema = self.get_model_schema(model, credentials)

        if model_schema and ModelPropertyKey.AUDOI_TYPE in model_schema.model_properties:
            return model_schema.model_properties[ModelPropertyKey.AUDOI_TYPE]

    def _get_model_word_limit(self, model: str, credentials: dict) -> int:
        """
        Get audio type for given tts model
        :return: audio type
        """
        model_schema = self.get_model_schema(model, credentials)

        if model_schema and ModelPropertyKey.WORD_LIMIT in model_schema.model_properties:
            return model_schema.model_properties[ModelPropertyKey.WORD_LIMIT]

    @staticmethod
    def split_text_into_sentences(text: str, limit: int, delimiters=None):
        if delimiters is None:
            delimiters = set('。！？；\n')

        buf = []
        word_count = 0
        for char in text:
            buf.append(char)
            if char in delimiters:
                if word_count >= limit:
                    yield ''.join(buf)
                    buf = []
                    word_count = 0
                else:
                    word_count += 1
            else:
                word_count += 1

        if buf:
            yield ''.join(buf)
