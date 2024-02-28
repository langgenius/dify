

class MoreLikeThisValidator:
    @classmethod
    def validate_and_set_defaults(cls, config: dict) -> tuple[dict, list[str]]:
        """
        Validate and set defaults for more like this feature

        :param config: app model config args
        """
        if not config.get("more_like_this"):
            config["more_like_this"] = {
                "enabled": False
            }

        if not isinstance(config["more_like_this"], dict):
            raise ValueError("more_like_this must be of dict type")

        if "enabled" not in config["more_like_this"] or not config["more_like_this"]["enabled"]:
            config["more_like_this"]["enabled"] = False

        if not isinstance(config["more_like_this"]["enabled"], bool):
            raise ValueError("enabled in more_like_this must be of boolean type")

        return config, ["more_like_this"]
