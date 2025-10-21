import logging
from collections.abc import Iterable

from pydantic import ConfigDict

from core.model_runtime.entities.model_entities import ModelType
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
        user: str | None = None,
    ) -> Iterable[bytes]:
        """
        Invoke large language model

        :param model: model name
        :param tenant_id: user tenant id
        :param credentials: model credentials
        :param voice: model timbre
        :param content_text: text content to be translated
        :param user: unique user id
        :return: translated audio file
        """
        try:
            from core.plugin.impl.model import PluginModelClient

            plugin_model_manager = PluginModelClient()
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

    def get_tts_model_voices(self, model: str, credentials: dict, language: str | None = None):
        """
        Retrieves the list of voices supported by a given text-to-speech (TTS) model.

        :param language: The language for which the voices are requested.
        :param model: The name of the TTS model.
        :param credentials: The credentials required to access the TTS model.
        :return: A list of voices supported by the TTS model.
        """
        from core.plugin.impl.model import PluginModelClient

        plugin_model_manager = PluginModelClient()
        return plugin_model_manager.get_tts_model_voices(
            tenant_id=self.tenant_id,
            user_id="unknown",
            plugin_id=self.plugin_id,
            provider=self.provider_name,
            model=model,
            credentials=credentials,
            language=language,
        )
