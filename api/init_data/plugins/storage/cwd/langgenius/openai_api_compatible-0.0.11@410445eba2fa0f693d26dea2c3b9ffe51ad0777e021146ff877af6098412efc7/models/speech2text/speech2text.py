from typing import Optional
from dify_plugin.entities.model import AIModelEntity, FetchFrom, I18nObject, ModelType
from dify_plugin.interfaces.model.openai_compatible.speech2text import (
    OAICompatSpeech2TextModel,
)


class OpenAISpeech2TextModel(OAICompatSpeech2TextModel):
    def get_customizable_model_schema(self, model: str, credentials: dict) -> Optional[AIModelEntity]:
        """
        used to define customizable model schema
        """
        entity = AIModelEntity(
            model=model,
            label=I18nObject(en_US=model),
            fetch_from=FetchFrom.CUSTOMIZABLE_MODEL,
            model_type=ModelType.SPEECH2TEXT,
            model_properties={},
            parameter_rules=[],
        )

        if "display_name" in credentials and credentials["display_name"] != "":
            entity.label= I18nObject(
                en_US=credentials["display_name"],
                zh_Hans=credentials["display_name"]
            )

        return entity
