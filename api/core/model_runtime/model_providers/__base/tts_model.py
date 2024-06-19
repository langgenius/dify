import hashlib
import subprocess
import uuid
from abc import abstractmethod
from typing import Optional

from pydantic import ConfigDict

from core.model_runtime.entities.model_entities import ModelPropertyKey, ModelType
from core.model_runtime.errors.invoke import InvokeBadRequestError
from core.model_runtime.model_providers.__base.ai_model import AIModel


class TTSModel(AIModel):
    """
    Model class for ttstext model.
    """
    model_type: ModelType = ModelType.TTS

    # pydantic configs
    model_config = ConfigDict(protected_namespaces=())

    def invoke(self, model: str, tenant_id: str, credentials: dict, content_text: str, voice: str, streaming: bool,
               user: Optional[str] = None):
        """
        Invoke large language model

        :param model: model name
        :param tenant_id: user tenant id
        :param credentials: model credentials
        :param voice: model timbre
        :param content_text: text content to be translated
        :param streaming: output is streaming
        :param user: unique user id
        :return: translated audio file
        """
        try:
            self._is_ffmpeg_installed()
            return self._invoke(model=model, credentials=credentials, user=user, streaming=streaming,
                                content_text=content_text, voice=voice, tenant_id=tenant_id)
        except Exception as e:
            raise self._transform_invoke_error(e)

    @abstractmethod
    def _invoke(self, model: str, tenant_id: str, credentials: dict, content_text: str, voice: str, streaming: bool,
                user: Optional[str] = None):
        """
        Invoke large language model

        :param model: model name
        :param tenant_id: user tenant id
        :param credentials: model credentials
        :param voice: model timbre
        :param content_text: text content to be translated
        :param streaming: output is streaming
        :param user: unique user id
        :return: translated audio file
        """
        raise NotImplementedError

    def get_tts_model_voices(self, model: str, credentials: dict, language: Optional[str] = None) -> list:
        """
        Get voice for given tts model voices

        :param language: tts language
        :param model: model name
        :param credentials: model credentials
        :return: voices lists
        """
        model_schema = self.get_model_schema(model, credentials)

        if model_schema and ModelPropertyKey.VOICES in model_schema.model_properties:
            voices = model_schema.model_properties[ModelPropertyKey.VOICES]
            if language:
                return [{'name': d['name'], 'value': d['mode']} for d in voices if language and language in d.get('language')]
            else:
                return [{'name': d['name'], 'value': d['mode']} for d in voices]

    def _get_model_default_voice(self, model: str, credentials: dict) -> any:
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

        if model_schema and ModelPropertyKey.AUDIO_TYPE in model_schema.model_properties:
            return model_schema.model_properties[ModelPropertyKey.AUDIO_TYPE]

    def _get_model_word_limit(self, model: str, credentials: dict) -> int:
        """
        Get audio type for given tts model
        :return: audio type
        """
        model_schema = self.get_model_schema(model, credentials)

        if model_schema and ModelPropertyKey.WORD_LIMIT in model_schema.model_properties:
            return model_schema.model_properties[ModelPropertyKey.WORD_LIMIT]

    def _get_model_workers_limit(self, model: str, credentials: dict) -> int:
        """
        Get audio max workers for given tts model
        :return: audio type
        """
        model_schema = self.get_model_schema(model, credentials)

        if model_schema and ModelPropertyKey.MAX_WORKERS in model_schema.model_properties:
            return model_schema.model_properties[ModelPropertyKey.MAX_WORKERS]

    @staticmethod
    def _split_text_into_sentences(text: str, limit: int, delimiters=None):
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

    @staticmethod
    def _is_ffmpeg_installed():
        try:
            output = subprocess.check_output("ffmpeg -version", shell=True)
            if "ffmpeg version" in output.decode("utf-8"):
                return True
            else:
                raise InvokeBadRequestError("ffmpeg is not installed, "
                                            "details: https://docs.dify.ai/getting-started/install-self-hosted"
                                            "/install-faq#id-14.-what-to-do-if-this-error-occurs-in-text-to-speech")
        except Exception:
            raise InvokeBadRequestError("ffmpeg is not installed, "
                                        "details: https://docs.dify.ai/getting-started/install-self-hosted"
                                        "/install-faq#id-14.-what-to-do-if-this-error-occurs-in-text-to-speech")

    # Todo: To improve the streaming function
    @staticmethod
    def _get_file_name(file_content: str) -> str:
        hash_object = hashlib.sha256(file_content.encode())
        hex_digest = hash_object.hexdigest()

        namespace_uuid = uuid.UUID('a5da6ef9-b303-596f-8e88-bf8fa40f4b31')
        unique_uuid = uuid.uuid5(namespace_uuid, hex_digest)
        return str(unique_uuid)
