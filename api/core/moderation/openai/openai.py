from core.moderation.base import BaseModeration

class OpenAIModeration(BaseModeration):
    type = "openai"

    @classmethod
    def validate_config(self, config: dict):
        self._validate_inputs_and_outputs_config(config, True)