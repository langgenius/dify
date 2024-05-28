class RetrievalResourceConfigManager:
    @classmethod
    def convert(cls, config: dict) -> bool:
        show_retrieve_source = False
        retriever_resource_dict = config.get('retriever_resource')
        if retriever_resource_dict:
            if retriever_resource_dict.get('enabled'):
                show_retrieve_source = True

        return show_retrieve_source

    @classmethod
    def validate_and_set_defaults(cls, config: dict) -> tuple[dict, list[str]]:
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
