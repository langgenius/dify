import logging
<<<<<<< HEAD
from typing import Optional
=======
import re
from abc import abstractmethod
from typing import Any, Optional
>>>>>>> main

from pydantic import ConfigDict

from core.model_runtime.entities.model_entities import ModelType
from core.model_runtime.model_providers.__base.ai_model import AIModel
from core.plugin.manager.model import PluginModelManager

logger = logging.getLogger(__name__)


class TTSModel(AIModel):
    """
    Model class for TTS model.
    """

    model_type: ModelType = ModelType.TTS

    # pydantic configs
    model_config = ConfigDict(protected_namespaces=())

    def invoke(
        self, model: str, tenant_id: str, credentials: dict, content_text: str, voice: str, user: Optional[str] = None
    ):
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
            plugin_model_manager = PluginModelManager()
            return plugin_model_manager.invoke_tts(
                tenant_id=self.tenant_id,
                user_id=user or "unknown",
                plugin_id=self.plugin_id,
                provider=self.provider_name,
                model=model,
                credentials=credentials,
                content_text=content_text,
                voice=voice,
            )
        except Exception as e:
            raise self._transform_invoke_error(e)

    def get_tts_model_voices(self, model: str, credentials: dict, language: Optional[str] = None) -> list[dict]:
        """
        Get voice for given tts model voices

        :param language: tts language
        :param model: model name
        :param credentials: model credentials
        :return: voices lists
        """
<<<<<<< HEAD
        plugin_model_manager = PluginModelManager()
        return plugin_model_manager.get_tts_model_voices(
            tenant_id=self.tenant_id,
            user_id="unknown",
            plugin_id=self.plugin_id,
            provider=self.provider_name,
            model=model,
            credentials=credentials,
            language=language,
        )
=======
        model_schema = self.get_model_schema(model, credentials)

        if model_schema and ModelPropertyKey.VOICES in model_schema.model_properties:
            voices = model_schema.model_properties[ModelPropertyKey.VOICES]
            if language:
                return [
                    {"name": d["name"], "value": d["mode"]}
                    for d in voices
                    if language and language in d.get("language")
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
>>>>>>> main
