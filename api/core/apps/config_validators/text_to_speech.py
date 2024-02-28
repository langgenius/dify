from typing import Tuple


class TextToSpeechValidator:
    @classmethod
    def validate_and_set_defaults(cls, config: dict) -> Tuple[dict, list[str]]:
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
