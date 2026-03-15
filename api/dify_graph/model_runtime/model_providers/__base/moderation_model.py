import time

from dify_graph.model_runtime.entities.model_entities import ModelType
from dify_graph.model_runtime.model_providers.__base.ai_model import AIModel


class ModerationModel(AIModel):
    """
    Model class for moderation model.
    """

    model_type: ModelType = ModelType.MODERATION

    def invoke(self, model: str, credentials: dict, text: str) -> bool:
        """
        Invoke moderation model

        :param model: model name
        :param credentials: model credentials
        :param text: text to moderate
        :return: false if text is safe, true otherwise
        """
        self.started_at = time.perf_counter()

        try:
            return self.model_runtime.invoke_moderation(
                provider=self.provider,
                model=model,
                credentials=credentials,
                text=text,
            )
        except Exception as e:
            raise self._transform_invoke_error(e)
