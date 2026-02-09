class RetrievalResourceConfigManager:
    @classmethod
    def convert(cls, config: dict) -> bool:
        show_retrieve_source = False
        retriever_resource_dict = config.get("retriever_resource")
        if retriever_resource_dict:
            if retriever_resource_dict.get("enabled"):
                show_retrieve_source = True

        return show_retrieve_source

    @classmethod
    def validate_and_set_defaults(cls, config: dict) -> tuple[dict, list[str]]:
        """
        Validate and set defaults for retriever resource feature

        :param config: app model config args
        """
        if not config.get("retriever_resource"):
            config["retriever_resource"] = {"enabled": False}

        if not isinstance(config["retriever_resource"], dict):
            raise ValueError("retriever_resource 必须为字典类型")

        if "enabled" not in config["retriever_resource"] or not config["retriever_resource"]["enabled"]:
            config["retriever_resource"]["enabled"] = False

        if not isinstance(config["retriever_resource"]["enabled"], bool):
            raise ValueError("retriever_resource 中的 enabled 必须为布尔类型")

        return config, ["retriever_resource"]
