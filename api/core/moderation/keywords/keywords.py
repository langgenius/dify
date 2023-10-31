from core.moderation.base import Moderation

class KeywordsModeration(Moderation):
    type = "keywords"

    @classmethod
    def validate_config(cls, config):
        keywords = config.get("keywords")
        if not keywords:
            raise ValueError("keywords is required")
        
        cls._validate_inputs_and_outputs_config(config, True)
        