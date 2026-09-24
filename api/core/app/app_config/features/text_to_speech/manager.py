from typing import Any

from core.app.app_config.entities import TextToSpeechEntity


class TextToSpeechConfigManager:
    @staticmethod
    def validate_optional_fields(config: dict[str, Any]) -> None:
        feature = config.get("text_to_speech")
        if feature is None:
            return
        if not isinstance(feature, dict):
            raise ValueError("text_to_speech must be of dict type")
        for key in ("voice", "language"):
            if key in feature and not isinstance(feature[key], str):
                raise ValueError(f"{key} in text_to_speech must be of string type")
        if "autoPlay" in feature and feature["autoPlay"] not in ("enabled", "disabled"):
            raise ValueError("autoPlay in text_to_speech must be enabled or disabled")

    @classmethod
    def convert(cls, config: dict[str, Any]):
        """
        Convert model config to model config

        :param config: model config args
        """
        text_to_speech = None
        text_to_speech_dict = config.get("text_to_speech")
        if text_to_speech_dict:
            if text_to_speech_dict.get("enabled"):
                text_to_speech = TextToSpeechEntity(
                    enabled=text_to_speech_dict.get("enabled"),
                    voice=text_to_speech_dict.get("voice"),
                    language=text_to_speech_dict.get("language"),
                )

        return text_to_speech

    @classmethod
    def validate_and_set_defaults(cls, config: dict[str, Any]) -> tuple[dict[str, Any], list[str]]:
        """
        Validate and set defaults for text to speech feature

        :param config: app model config args
        """
        if not config.get("text_to_speech"):
            config["text_to_speech"] = {"enabled": False, "voice": "", "language": ""}

        if not isinstance(config["text_to_speech"], dict):
            raise ValueError("text_to_speech must be of dict type")

        cls.validate_optional_fields(config)

        if "enabled" not in config["text_to_speech"] or not config["text_to_speech"]["enabled"]:
            config["text_to_speech"]["enabled"] = False
            config["text_to_speech"]["voice"] = ""
            config["text_to_speech"]["language"] = ""

        if not isinstance(config["text_to_speech"]["enabled"], bool):
            raise ValueError("enabled in text_to_speech must be of boolean type")

        return config, ["text_to_speech"]
