from core.moderation.base import BaseModeration

class KeywordsModeration(BaseModeration):
    register_name = "keywords"

    @classmethod
    def validate_config(self, config):
        keywords = config.get("keywords")
        if not keywords:
            raise ValueError("keywords is required")
        
        self._validate_inputs_and_outputs_config(config, True)
        