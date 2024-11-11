import uuid
from typing import Optional

from core.agent.entities import AgentEntity
from core.app.app_config.base_app_config_manager import BaseAppConfigManager
from core.app.app_config.common.sensitive_word_avoidance.manager import SensitiveWordAvoidanceConfigManager
from core.app.app_config.easy_ui_based_app.agent.manager import AgentConfigManager
from core.app.app_config.easy_ui_based_app.dataset.manager import DatasetConfigManager
from core.app.app_config.easy_ui_based_app.model_config.manager import ModelConfigManager
from core.app.app_config.easy_ui_based_app.prompt_template.manager import PromptTemplateConfigManager
from core.app.app_config.easy_ui_based_app.variables.manager import BasicVariablesConfigManager
from core.app.app_config.entities import EasyUIBasedAppConfig, EasyUIBasedAppModelConfigFrom
from core.app.app_config.features.file_upload.manager import FileUploadConfigManager
from core.app.app_config.features.opening_statement.manager import OpeningStatementConfigManager
from core.app.app_config.features.retrieval_resource.manager import RetrievalResourceConfigManager
from core.app.app_config.features.speech_to_text.manager import SpeechToTextConfigManager
from core.app.app_config.features.suggested_questions_after_answer.manager import (
    SuggestedQuestionsAfterAnswerConfigManager,
)
from core.app.app_config.features.text_to_speech.manager import TextToSpeechConfigManager
from core.entities.agent_entities import PlanningStrategy
from models.model import App, AppMode, AppModelConfig, Conversation

OLD_TOOLS = ["dataset", "google_search", "web_reader", "wikipedia", "current_datetime"]


class AgentChatAppConfig(EasyUIBasedAppConfig):
    """
    Agent Chatbot App Config Entity.
    """

    agent: Optional[AgentEntity] = None


class AgentChatAppConfigManager(BaseAppConfigManager):
    @classmethod
    def get_app_config(
        cls,
        app_model: App,
        app_model_config: AppModelConfig,
        conversation: Optional[Conversation] = None,
        override_config_dict: Optional[dict] = None,
    ) -> AgentChatAppConfig:
        """
        Convert app model config to agent chat app config
        :param app_model: app model
        :param app_model_config: app model config
        :param conversation: conversation
        :param override_config_dict: app model config dict
        :return:
        """
        if override_config_dict:
            config_from = EasyUIBasedAppModelConfigFrom.ARGS
        elif conversation:
            config_from = EasyUIBasedAppModelConfigFrom.CONVERSATION_SPECIFIC_CONFIG
        else:
            config_from = EasyUIBasedAppModelConfigFrom.APP_LATEST_CONFIG

        if config_from != EasyUIBasedAppModelConfigFrom.ARGS:
            app_model_config_dict = app_model_config.to_dict()
            config_dict = app_model_config_dict.copy()
        else:
            config_dict = override_config_dict

        app_mode = AppMode.value_of(app_model.mode)
        app_config = AgentChatAppConfig(
            tenant_id=app_model.tenant_id,
            app_id=app_model.id,
            app_mode=app_mode,
            app_model_config_from=config_from,
            app_model_config_id=app_model_config.id,
            app_model_config_dict=config_dict,
            model=ModelConfigManager.convert(config=config_dict),
            prompt_template=PromptTemplateConfigManager.convert(config=config_dict),
            sensitive_word_avoidance=SensitiveWordAvoidanceConfigManager.convert(config=config_dict),
            dataset=DatasetConfigManager.convert(config=config_dict),
            agent=AgentConfigManager.convert(config=config_dict),
            additional_features=cls.convert_features(config_dict, app_mode),
        )

        app_config.variables, app_config.external_data_variables = BasicVariablesConfigManager.convert(
            config=config_dict
        )

        return app_config

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
        config, current_related_config_keys = ModelConfigManager.validate_and_set_defaults(tenant_id, config)
        related_config_keys.extend(current_related_config_keys)

        # user_input_form
        config, current_related_config_keys = BasicVariablesConfigManager.validate_and_set_defaults(tenant_id, config)
        related_config_keys.extend(current_related_config_keys)

        # file upload validation
        config, current_related_config_keys = FileUploadConfigManager.validate_and_set_defaults(config)
        related_config_keys.extend(current_related_config_keys)

        # prompt
        config, current_related_config_keys = PromptTemplateConfigManager.validate_and_set_defaults(app_mode, config)
        related_config_keys.extend(current_related_config_keys)

        # agent_mode
        config, current_related_config_keys = cls.validate_agent_mode_and_set_defaults(tenant_id, config)
        related_config_keys.extend(current_related_config_keys)

        # opening_statement
        config, current_related_config_keys = OpeningStatementConfigManager.validate_and_set_defaults(config)
        related_config_keys.extend(current_related_config_keys)

        # suggested_questions_after_answer
        config, current_related_config_keys = SuggestedQuestionsAfterAnswerConfigManager.validate_and_set_defaults(
            config
        )
        related_config_keys.extend(current_related_config_keys)

        # speech_to_text
        config, current_related_config_keys = SpeechToTextConfigManager.validate_and_set_defaults(config)
        related_config_keys.extend(current_related_config_keys)

        # text_to_speech
        config, current_related_config_keys = TextToSpeechConfigManager.validate_and_set_defaults(config)
        related_config_keys.extend(current_related_config_keys)

        # return retriever resource
        config, current_related_config_keys = RetrievalResourceConfigManager.validate_and_set_defaults(config)
        related_config_keys.extend(current_related_config_keys)

        # dataset configs
        # dataset_query_variable
        config, current_related_config_keys = DatasetConfigManager.validate_and_set_defaults(
            tenant_id, app_mode, config
        )
        related_config_keys.extend(current_related_config_keys)

        # moderation validation
        config, current_related_config_keys = SensitiveWordAvoidanceConfigManager.validate_and_set_defaults(
            tenant_id, config
        )
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
            config["agent_mode"] = {"enabled": False, "tools": []}

        if not isinstance(config["agent_mode"], dict):
            raise ValueError("agent_mode must be of object type")

        if "enabled" not in config["agent_mode"] or not config["agent_mode"]["enabled"]:
            config["agent_mode"]["enabled"] = False

        if not isinstance(config["agent_mode"]["enabled"], bool):
            raise ValueError("enabled in agent_mode must be of boolean type")

        if not config["agent_mode"].get("strategy"):
            config["agent_mode"]["strategy"] = PlanningStrategy.ROUTER.value

        if config["agent_mode"]["strategy"] not in [
            member.value for member in list(PlanningStrategy.__members__.values())
        ]:
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
                    if "id" not in tool_item:
                        raise ValueError("id is required in dataset")

                    try:
                        uuid.UUID(tool_item["id"])
                    except ValueError:
                        raise ValueError("id in dataset must be of UUID type")

                    if not DatasetConfigManager.is_dataset_exists(tenant_id, tool_item["id"]):
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
