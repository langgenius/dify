from core.moderation.base import BaseModeration

class KeywordsModeration(BaseModeration):
    type = "keywords"

    @classmethod
    def validate_config(cls, config):
        keywords = config.get("keywords")
        if not keywords:
            raise ValueError("keywords is required")
        
        cls._validate_inputs_and_outputs_config(config, True)
        