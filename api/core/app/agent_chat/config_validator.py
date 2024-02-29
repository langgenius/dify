import uuid

from core.entities.agent_entities import PlanningStrategy
from core.app.validators.dataset_retrieval import DatasetValidator
from core.app.validators.external_data_fetch import ExternalDataFetchValidator
from core.app.validators.file_upload import FileUploadValidator
from core.app.validators.model_validator import ModelValidator
from core.app.validators.moderation import ModerationValidator
from core.app.validators.opening_statement import OpeningStatementValidator
from core.app.validators.prompt import PromptValidator
from core.app.validators.retriever_resource import RetrieverResourceValidator
from core.app.validators.speech_to_text import SpeechToTextValidator
from core.app.validators.suggested_questions import SuggestedQuestionsValidator
from core.app.validators.text_to_speech import TextToSpeechValidator
from core.app.validators.user_input_form import UserInputFormValidator
from models.model import AppMode


OLD_TOOLS = ["dataset", "google_search", "web_reader", "wikipedia", "current_datetime"]


class AgentChatAppConfigValidator:
    @classmethod
    def config_validate(cls, tenant_id: str, config: dict) -> dict:
        """
        Validate for agent chat app model config

        :param tenant_id: tenant id
        :param config: app model config args
        """
        app_mode = AppMode.AGENT_CHAT

        related_config_keys = []

        # model
        config, current_related_config_keys = ModelValidator.validate_and_set_defaults(tenant_id, config)
        related_config_keys.extend(current_related_config_keys)

        # user_input_form
        config, current_related_config_keys = UserInputFormValidator.validate_and_set_defaults(config)
        related_config_keys.extend(current_related_config_keys)

        # external data tools validation
        config, current_related_config_keys = ExternalDataFetchValidator.validate_and_set_defaults(tenant_id, config)
        related_config_keys.extend(current_related_config_keys)

        # file upload validation
        config, current_related_config_keys = FileUploadValidator.validate_and_set_defaults(config)
        related_config_keys.extend(current_related_config_keys)

        # prompt
        config, current_related_config_keys = PromptValidator.validate_and_set_defaults(app_mode, config)
        related_config_keys.extend(current_related_config_keys)

        # agent_mode
        config, current_related_config_keys = cls.validate_agent_mode_and_set_defaults(tenant_id, config)
        related_config_keys.extend(current_related_config_keys)

        # opening_statement
        config, current_related_config_keys = OpeningStatementValidator.validate_and_set_defaults(config)
        related_config_keys.extend(current_related_config_keys)

        # suggested_questions_after_answer
        config, current_related_config_keys = SuggestedQuestionsValidator.validate_and_set_defaults(config)
        related_config_keys.extend(current_related_config_keys)

        # speech_to_text
        config, current_related_config_keys = SpeechToTextValidator.validate_and_set_defaults(config)
        related_config_keys.extend(current_related_config_keys)

        # text_to_speech
        config, current_related_config_keys = TextToSpeechValidator.validate_and_set_defaults(config)
        related_config_keys.extend(current_related_config_keys)

        # return retriever resource
        config, current_related_config_keys = RetrieverResourceValidator.validate_and_set_defaults(config)
        related_config_keys.extend(current_related_config_keys)

        # moderation validation
        config, current_related_config_keys = ModerationValidator.validate_and_set_defaults(tenant_id, config)
        related_config_keys.extend(current_related_config_keys)

        related_config_keys = list(set(related_config_keys))

        # Filter out extra parameters
        filtered_config = {key: config.get(key) for key in related_config_keys}

        return filtered_config

    @classmethod
    def validate_agent_mode_and_set_defaults(cls, tenant_id: str, config: dict) -> tuple[dict, list[str]]:
        """
        Validate agent_mode and set defaults for agent feature

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

        if config["agent_mode"]["strategy"] not in [member.value for member in
                                                    list(PlanningStrategy.__members__.values())]:
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
