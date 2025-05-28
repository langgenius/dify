from typing import IO, Optional

from pydantic import ConfigDict

from core.model_runtime.entities.model_entities import ModelType
from core.model_runtime.model_providers.__base.ai_model import AIModel
from core.plugin.impl.model import PluginModelClient


class Speech2TextModel(AIModel):
    """
    Model class for speech2text model.
    """

    model_type: ModelType = ModelType.SPEECH2TEXT

    # pydantic configs
    model_config = ConfigDict(protected_namespaces=())

    def invoke(self, model: str, credentials: dict, file: IO[bytes], user: Optional[str] = None) -> str:
        """
        Invoke speech to text model

        :param model: model name
        :param credentials: model credentials
        :param file: audio file
        :param user: unique user id
        :return: text for given audio file
        """
        try:
            plugin_model_manager = PluginModelClient()
            return plugin_model_manager.invoke_speech_to_text(
                tenant_id=self.tenant_id,
                user_id=user or "unknown",
                plugin_id=self.plugin_id,
                provider=self.provider_name,
                model=model,
                credentials=credentials,
                file=file,
            )
        except Exception as e:
            raise self._transform_invoke_error(e)
