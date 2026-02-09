class SpeechToTextConfigManager:
    @classmethod
    def convert(cls, config: dict) -> bool:
        """
        Convert model config to model config

        :param config: model config args
        """
        speech_to_text = False
        speech_to_text_dict = config.get("speech_to_text")
        if speech_to_text_dict:
            if speech_to_text_dict.get("enabled"):
                speech_to_text = True

        return speech_to_text

    @classmethod
    def validate_and_set_defaults(cls, config: dict) -> tuple[dict, list[str]]:
        """
        Validate and set defaults for speech to text feature

        :param config: app model config args
        """
        if not config.get("speech_to_text"):
            config["speech_to_text"] = {"enabled": False}

        if not isinstance(config["speech_to_text"], dict):
            raise ValueError("speech_to_text 必须为字典类型")

        if "enabled" not in config["speech_to_text"] or not config["speech_to_text"]["enabled"]:
            config["speech_to_text"]["enabled"] = False

        if not isinstance(config["speech_to_text"]["enabled"], bool):
            raise ValueError("speech_to_text 中的 enabled 必须为布尔类型")

        return config, ["speech_to_text"]
