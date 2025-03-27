from typing import Mapping

from dify_plugin.entities.model import (
    AIModelEntity,
    I18nObject,
    ModelFeature
)

from dify_plugin.interfaces.model.openai_compatible.llm import (
    OAICompatLargeLanguageModel,
)


class OpenAILargeLanguageModel(OAICompatLargeLanguageModel):
    def get_customizable_model_schema(self, model: str, credentials: Mapping) -> AIModelEntity:
        entity = super().get_customizable_model_schema(model, credentials)

        agent_though_support = credentials.get("agent_though_support", "not_supported")
        if agent_though_support == "supported":
            try:
                entity.features.index(ModelFeature.AGENT_THOUGHT)
            except ValueError:
                entity.features.append(ModelFeature.AGENT_THOUGHT)

        if "display_name" in credentials and credentials["display_name"] != "":
            entity.label= I18nObject(
                en_US=credentials["display_name"],
                zh_Hans=credentials["display_name"]
            )

        return entity
