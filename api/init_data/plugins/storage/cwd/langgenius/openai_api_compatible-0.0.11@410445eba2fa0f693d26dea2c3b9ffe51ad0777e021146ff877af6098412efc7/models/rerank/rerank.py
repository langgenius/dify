from typing import Mapping

from dify_plugin.entities.model import (
    AIModelEntity,
    I18nObject
)

from dify_plugin.interfaces.model.openai_compatible.rerank import (
    OAICompatRerankModel,
)
from dify_plugin.errors.model import (
    CredentialsValidateFailedError,
)

class OpenAIRerankModel(OAICompatRerankModel):
    def validate_credentials(self, model: str, credentials: dict) -> None:
        """
        Validate model credentials

        :param model: model name
        :param credentials: model credentials
        :return:
        """
        try:
            self._invoke(
                model=model,
                credentials=credentials,
                query="What is the capital of the United States?",
                docs=[
                    "Carson City is the capital city of the American state of Nevada. At the 2010 United States "
                    "Census, Carson City had a population of 55,274.",
                    "The Commonwealth of the Northern Mariana Islands is a group of islands in the Pacific Ocean that "
                    "are a political division controlled by the United States. Its capital is Saipan.",
                ],
                score_threshold=0.8,
                top_n=3,
            )
        except Exception as ex:
            raise CredentialsValidateFailedError(str(ex)) from ex

    def get_customizable_model_schema(self, model: str, credentials: Mapping) -> AIModelEntity:
        entity = super().get_customizable_model_schema(model, credentials)

        if "display_name" in credentials and credentials["display_name"] != "":
            entity.label= I18nObject(
                en_US=credentials["display_name"],
                zh_Hans=credentials["display_name"]
            )

        return entity
