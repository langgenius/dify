

class SpeechToTextValidator:
    @classmethod
    def validate_and_set_defaults(cls, config: dict) -> tuple[dict, list[str]]:
        """
        Validate and set defaults for speech to text feature

        :param config: app model config args
        """
        if not config.get("speech_to_text"):
            config["speech_to_text"] = {
                "enabled": False
            }

        if not isinstance(config["speech_to_text"], dict):
            raise ValueError("speech_to_text must be of dict type")

        if "enabled" not in config["speech_to_text"] or not config["speech_to_text"]["enabled"]:
            config["speech_to_text"]["enabled"] = False

        if not isinstance(config["speech_to_text"]["enabled"], bool):
            raise ValueError("enabled in speech_to_text must be of boolean type")

        return config, ["speech_to_text"]
