from core.app.app_config.entities import TextToSpeechEntity


class TextToSpeechConfigManager:
    @classmethod
    def convert(cls, config: dict):
        """
        Convert model config to model config

        :param config: model config args
        """
        text_to_speech = None
        text_to_speech_dict = config.get('text_to_speech')
        if text_to_speech_dict:
            if text_to_speech_dict.get('enabled'):
                text_to_speech = TextToSpeechEntity(
                    enabled=text_to_speech_dict.get('enabled'),
                    voice=text_to_speech_dict.get('voice'),
                    language=text_to_speech_dict.get('language'),
                )

        return text_to_speech

    @classmethod
    def validate_and_set_defaults(cls, config: dict) -> tuple[dict, list[str]]:
        """
        Validate and set defaults for text to speech feature

        :param config: app model config args
        """
        if not config.get("text_to_speech"):
            config["text_to_speech"] = {
                "enabled": False,
                "voice": "",
                "language": ""
            }

        if not isinstance(config["text_to_speech"], dict):
            raise ValueError("text_to_speech must be of dict type")

        if "enabled" not in config["text_to_speech"] or not config["text_to_speech"]["enabled"]:
            config["text_to_speech"]["enabled"] = False
            config["text_to_speech"]["voice"] = ""
            config["text_to_speech"]["language"] = ""

        if not isinstance(config["text_to_speech"]["enabled"], bool):
            raise ValueError("enabled in text_to_speech must be of boolean type")

        return config, ["text_to_speech"]
