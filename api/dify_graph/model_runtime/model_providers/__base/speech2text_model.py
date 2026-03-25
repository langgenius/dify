from typing import IO

from dify_graph.model_runtime.entities.model_entities import ModelType
from dify_graph.model_runtime.model_providers.__base.ai_model import AIModel


class Speech2TextModel(AIModel):
    """
    Model class for speech2text model.
    """

    model_type: ModelType = ModelType.SPEECH2TEXT

    def invoke(self, model: str, credentials: dict, file: IO[bytes]) -> str:
        """
        Invoke speech to text model

        :param model: model name
        :param credentials: model credentials
        :param file: audio file
        :return: text for given audio file
        """
        try:
            return self.model_runtime.invoke_speech_to_text(
                provider=self.provider,
                model=model,
                credentials=credentials,
                file=file,
            )
        except Exception as e:
            raise self._transform_invoke_error(e)
