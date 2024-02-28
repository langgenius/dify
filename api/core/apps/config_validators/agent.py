import uuid
from typing import Tuple

from core.agent.agent_executor import PlanningStrategy
from core.apps.config_validators.dataset import DatasetValidator

OLD_TOOLS = ["dataset", "google_search", "web_reader", "wikipedia", "current_datetime"]


class AgentValidator:
    @classmethod
    def validate_and_set_defaults(cls, tenant_id: str, config: dict) -> Tuple[dict, list[str]]:
        """
        Validate and set defaults for agent feature

        :param tenant_id: tenant ID
        :param config: app model config args
        """
        if not config.get("agent_mode"):
            config["agent_mode"] = {
                "enabled": False,
                "tools": []
            }

        if not isinstance(config["agent_mode"], dict):
            raise ValueError("agent_mode must be of object type")

        if "enabled" not in config["agent_mode"] or not config["agent_mode"]["enabled"]:
            config["agent_mode"]["enabled"] = False

        if not isinstance(config["agent_mode"]["enabled"], bool):
            raise ValueError("enabled in agent_mode must be of boolean type")

        if not config["agent_mode"].get("strategy"):
            config["agent_mode"]["strategy"] = PlanningStrategy.ROUTER.value

        if config["agent_mode"]["strategy"] not in [member.value for member in list(PlanningStrategy.__members__.values())]:
            raise ValueError("strategy in agent_mode must be in the specified strategy list")

        if not config["agent_mode"].get("tools"):
            config["agent_mode"]["tools"] = []

        if not isinstance(config["agent_mode"]["tools"], list):
            raise ValueError("tools in agent_mode must be a list of objects")

        for tool in config["agent_mode"]["tools"]:
            key = list(tool.keys())[0]
            if key in OLD_TOOLS:
                # old style, use tool name as key
                tool_item = tool[key]

                if "enabled" not in tool_item or not tool_item["enabled"]:
                    tool_item["enabled"] = False

                if not isinstance(tool_item["enabled"], bool):
                    raise ValueError("enabled in agent_mode.tools must be of boolean type")

                if key == "dataset":
                    if 'id' not in tool_item:
                        raise ValueError("id is required in dataset")

                    try:
                        uuid.UUID(tool_item["id"])
                    except ValueError:
                        raise ValueError("id in dataset must be of UUID type")

                    if not DatasetValidator.is_dataset_exists(tenant_id, tool_item["id"]):
                        raise ValueError("Dataset ID does not exist, please check your permission.")
            else:
                # latest style, use key-value pair
                if "enabled" not in tool or not tool["enabled"]:
                    tool["enabled"] = False
                if "provider_type" not in tool:
                    raise ValueError("provider_type is required in agent_mode.tools")
                if "provider_id" not in tool:
                    raise ValueError("provider_id is required in agent_mode.tools")
                if "tool_name" not in tool:
                    raise ValueError("tool_name is required in agent_mode.tools")
                if "tool_parameters" not in tool:
                    raise ValueError("tool_parameters is required in agent_mode.tools")

        return config, ["agent_mode"]
