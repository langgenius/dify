from typing import Tuple


class RetrieverResourceValidator:
    @classmethod
    def validate_and_set_defaults(cls, config: dict) -> Tuple[dict, list[str]]:
        """
        Validate and set defaults for retriever resource feature

        :param config: app model config args
        """
        if not config.get("retriever_resource"):
            config["retriever_resource"] = {
                "enabled": False
            }

        if not isinstance(config["retriever_resource"], dict):
            raise ValueError("retriever_resource must be of dict type")

        if "enabled" not in config["retriever_resource"] or not config["retriever_resource"]["enabled"]:
            config["retriever_resource"]["enabled"] = False

        if not isinstance(config["retriever_resource"]["enabled"], bool):
            raise ValueError("enabled in retriever_resource must be of boolean type")

        return config, ["retriever_resource"]
