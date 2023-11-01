from typing import Optional

from core.moderation.base import Moderation


class OpenAIModeration(Moderation):
    name: str = "openai_moderation"

    @classmethod
    def validate_config(cls, tenant_id: str, config: dict) -> None:
        """
        Validate the incoming form config data.

        :param tenant_id: the id of workspace
        :param config: the form config data
        :return:
        """
        super().validate_config(tenant_id, config)
        cls._validate_inputs_and_outputs_config(config, True)

    def moderation_for_inputs(self, inputs: dict, query: Optional[str] = None):
        pass

    def moderation_for_outputs(self, text: str):
        pass