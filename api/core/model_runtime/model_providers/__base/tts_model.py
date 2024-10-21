import logging
import re
from abc import abstractmethod
from collections.abc import Iterable
from typing import Any, Optional

from pydantic import ConfigDict

from core.model_runtime.entities.model_entities import ModelPropertyKey, ModelType
from core.model_runtime.model_providers.__base.ai_model import AIModel

logger = logging.getLogger(__name__)


class TTSModel(AIModel):
    """
    Model class for TTS model.
    """

    model_type: ModelType = ModelType.TTS

    # pydantic configs
    model_config = ConfigDict(protected_namespaces=())

    def invoke(
        self,
        model: str,
        tenant_id: str,
        credentials: dict,
        content_text: str,
        voice: str,
        user: Optional[str] = None,
    ) -> Iterable[bytes]:
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
            return self._invoke(
                model=model,
                credentials=credentials,
                user=user,
                content_text=content_text,
                voice=voice,
                tenant_id=tenant_id,
            )
        except Exception as e:
            raise self._transform_invoke_error(e)

    @abstractmethod
    def _invoke(
        self,
        model: str,
        tenant_id: str,
        credentials: dict,
        content_text: str,
        voice: str,
        user: Optional[str] = None,
    ) -> Iterable[bytes]:
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
        Retrieves the list of voices supported by a given text-to-speech (TTS) model.

        :param language: The language for which the voices are requested.
        :param model: The name of the TTS model.
        :param credentials: The credentials required to access the TTS model.
        :return: A list of voices supported by the TTS model.
        """
        model_schema = self.get_model_schema(model, credentials)

        if not model_schema or ModelPropertyKey.VOICES not in model_schema.model_properties:
            raise ValueError("this model does not support voice")

        voices = model_schema.model_properties[ModelPropertyKey.VOICES]
        if language:
            return [
                {"name": d["name"], "value": d["mode"]} for d in voices if language and language in d.get("language")
            ]
        else:
            return [{"name": d["name"], "value": d["mode"]} for d in voices]

    def _get_model_default_voice(self, model: str, credentials: dict) -> Any:
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

        if not model_schema or ModelPropertyKey.AUDIO_TYPE not in model_schema.model_properties:
            raise ValueError("this model does not support audio type")

        return model_schema.model_properties[ModelPropertyKey.AUDIO_TYPE]

    def _get_model_word_limit(self, model: str, credentials: dict) -> int:
        """
        Get audio type for given tts model
        :return: audio type
        """
        model_schema = self.get_model_schema(model, credentials)

        if not model_schema or ModelPropertyKey.WORD_LIMIT not in model_schema.model_properties:
            raise ValueError("this model does not support word limit")

        return model_schema.model_properties[ModelPropertyKey.WORD_LIMIT]

    def _get_model_workers_limit(self, model: str, credentials: dict) -> int:
        """
        Get audio max workers for given tts model
        :return: audio type
        """
        model_schema = self.get_model_schema(model, credentials)

        if not model_schema or ModelPropertyKey.MAX_WORKERS not in model_schema.model_properties:
            raise ValueError("this model does not support max workers")

        return model_schema.model_properties[ModelPropertyKey.MAX_WORKERS]

    @staticmethod
    def _split_text_into_sentences(org_text, max_length=2000, pattern=r"[。.!?]"):
        match = re.compile(pattern)
        tx = match.finditer(org_text)
        start = 0
        result = []
        one_sentence = ""
        for i in tx:
            end = i.regs[0][1]
            tmp = org_text[start:end]
            if len(one_sentence + tmp) > max_length:
                result.append(one_sentence)
                one_sentence = ""
            one_sentence += tmp
            start = end
        last_sens = org_text[start:]
        if last_sens:
            one_sentence += last_sens
        if one_sentence != "":
            result.append(one_sentence)
        return result
