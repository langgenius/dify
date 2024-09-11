from abc import abstractmethod
from typing import IO, Optional

from pydantic import ConfigDict

from core.model_runtime.entities.model_entities import ModelType
from core.model_runtime.model_providers.__base.ai_model import AIModel


class Text2ImageModel(AIModel):
    """
    Model class for text2img model.
    """

    model_type: ModelType = ModelType.TEXT2IMG

    # pydantic configs
    model_config = ConfigDict(protected_namespaces=())

    def invoke(
        self, model: str, credentials: dict, prompt: str, model_parameters: dict, user: Optional[str] = None
    ) -> list[IO[bytes]]:
        """
        Invoke Text2Image model

        :param model: model name
        :param credentials: model credentials
        :param prompt: prompt for image generation
        :param model_parameters: model parameters
        :param user: unique user id

        :return: image bytes
        """
        try:
            return self._invoke(model, credentials, prompt, model_parameters, user)
        except Exception as e:
            raise self._transform_invoke_error(e)

    @abstractmethod
    def _invoke(
        self, model: str, credentials: dict, prompt: str, model_parameters: dict, user: Optional[str] = None
    ) -> list[IO[bytes]]:
        """
        Invoke Text2Image model

        :param model: model name
        :param credentials: model credentials
        :param prompt: prompt for image generation
        :param model_parameters: model parameters
        :param user: unique user id

        :return: image bytes
        """
        raise NotImplementedError
