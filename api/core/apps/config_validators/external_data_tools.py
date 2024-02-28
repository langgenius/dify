
from core.external_data_tool.factory import ExternalDataToolFactory


class ExternalDataToolsValidator:
    @classmethod
    def validate_and_set_defaults(cls, tenant_id: str, config: dict) -> tuple[dict, list[str]]:
        """
        Validate and set defaults for external data fetch feature

        :param tenant_id: workspace id
        :param config: app model config args
        """
        if not config.get("external_data_tools"):
            config["external_data_tools"] = []

        if not isinstance(config["external_data_tools"], list):
            raise ValueError("external_data_tools must be of list type")

        for tool in config["external_data_tools"]:
            if "enabled" not in tool or not tool["enabled"]:
                tool["enabled"] = False

            if not tool["enabled"]:
                continue

            if "type" not in tool or not tool["type"]:
                raise ValueError("external_data_tools[].type is required")

            typ = tool["type"]
            config = tool["config"]

            ExternalDataToolFactory.validate_config(
                name=typ,
                tenant_id=tenant_id,
                config=config
            )

        return config, ["external_data_tools"]
