import re
import uuid

from core.entities.agent_entities import PlanningStrategy
from core.external_data_tool.factory import ExternalDataToolFactory
from core.model_runtime.entities.model_entities import ModelPropertyKey, ModelType
from core.model_runtime.model_providers import model_provider_factory
from core.moderation.factory import ModerationFactory
from core.prompt.prompt_transform import AppMode
from core.provider_manager import ProviderManager
from models.account import Account
from services.dataset_service import DatasetService

SUPPORT_TOOLS = ["dataset", "google_search", "web_reader", "wikipedia", "current_datetime"]


class AppModelConfigService:
    @classmethod
    def is_dataset_exists(cls, account: Account, dataset_id: str) -> bool:
        # verify if the dataset ID exists
        dataset = DatasetService.get_dataset(dataset_id)

        if not dataset:
            return False

        if dataset.tenant_id != account.current_tenant_id:
            return False

        return True

    @classmethod
    def validate_model_completion_params(cls, cp: dict, model_name: str) -> dict:
        # 6. model.completion_params
        if not isinstance(cp, dict):
            raise ValueError("model.completion_params must be of object type")

        # stop
        if 'stop' not in cp:
            cp["stop"] = []
        elif not isinstance(cp["stop"], list):
            raise ValueError("stop in model.completion_params must be of list type")

        if len(cp["stop"]) > 4:
            raise ValueError("stop sequences must be less than 4")

        return cp

    @classmethod
    def validate_configuration(cls, tenant_id: str, account: Account, config: dict, app_mode: str) -> dict:
        # opening_statement
        if 'opening_statement' not in config or not config["opening_statement"]:
            config["opening_statement"] = ""

        if not isinstance(config["opening_statement"], str):
            raise ValueError("opening_statement must be of string type")

        # suggested_questions
        if 'suggested_questions' not in config or not config["suggested_questions"]:
            config["suggested_questions"] = []

        if not isinstance(config["suggested_questions"], list):
            raise ValueError("suggested_questions must be of list type")

        for question in config["suggested_questions"]:
            if not isinstance(question, str):
                raise ValueError("Elements in suggested_questions list must be of string type")

        # suggested_questions_after_answer
        if 'suggested_questions_after_answer' not in config or not config["suggested_questions_after_answer"]:
            config["suggested_questions_after_answer"] = {
                "enabled": False
            }

        if not isinstance(config["suggested_questions_after_answer"], dict):
            raise ValueError("suggested_questions_after_answer must be of dict type")

        if "enabled" not in config["suggested_questions_after_answer"] or not config["suggested_questions_after_answer"]["enabled"]:
            config["suggested_questions_after_answer"]["enabled"] = False

        if not isinstance(config["suggested_questions_after_answer"]["enabled"], bool):
            raise ValueError("enabled in suggested_questions_after_answer must be of boolean type")

        # speech_to_text
        if 'speech_to_text' not in config or not config["speech_to_text"]:
            config["speech_to_text"] = {
                "enabled": False
            }

        if not isinstance(config["speech_to_text"], dict):
            raise ValueError("speech_to_text must be of dict type")

        if "enabled" not in config["speech_to_text"] or not config["speech_to_text"]["enabled"]:
            config["speech_to_text"]["enabled"] = False

        if not isinstance(config["speech_to_text"]["enabled"], bool):
            raise ValueError("enabled in speech_to_text must be of boolean type")

        # text_to_speech
        if 'text_to_speech' not in config or not config["text_to_speech"]:
            config["text_to_speech"] = {
                "enabled": False,
                "voice": "",
                "language": ""
            }

        if not isinstance(config["text_to_speech"], dict):
            raise ValueError("text_to_speech must be of dict type")

        if "enabled" not in config["text_to_speech"] or not config["text_to_speech"]["enabled"]:
            config["text_to_speech"]["enabled"] = False
            config["text_to_speech"]["voice"] = ""
            config["text_to_speech"]["language"] = ""

        if not isinstance(config["text_to_speech"]["enabled"], bool):
            raise ValueError("enabled in text_to_speech must be of boolean type")

        # return retriever resource
        if 'retriever_resource' not in config or not config["retriever_resource"]:
            config["retriever_resource"] = {
                "enabled": False
            }

        if not isinstance(config["retriever_resource"], dict):
            raise ValueError("retriever_resource must be of dict type")

        if "enabled" not in config["retriever_resource"] or not config["retriever_resource"]["enabled"]:
            config["retriever_resource"]["enabled"] = False

        if not isinstance(config["retriever_resource"]["enabled"], bool):
            raise ValueError("enabled in retriever_resource must be of boolean type")

        # more_like_this
        if 'more_like_this' not in config or not config["more_like_this"]:
            config["more_like_this"] = {
                "enabled": False
            }

        if not isinstance(config["more_like_this"], dict):
            raise ValueError("more_like_this must be of dict type")

        if "enabled" not in config["more_like_this"] or not config["more_like_this"]["enabled"]:
            config["more_like_this"]["enabled"] = False

        if not isinstance(config["more_like_this"]["enabled"], bool):
            raise ValueError("enabled in more_like_this must be of boolean type")

        # model
        if 'model' not in config:
            raise ValueError("model is required")

        if not isinstance(config["model"], dict):
            raise ValueError("model must be of object type")

        # model.provider
        provider_entities = model_provider_factory.get_providers()
        model_provider_names = [provider.provider for provider in provider_entities]
        if 'provider' not in config["model"] or config["model"]["provider"] not in model_provider_names:
            raise ValueError(f"model.provider is required and must be in {str(model_provider_names)}")

        # model.name
        if 'name' not in config["model"]:
            raise ValueError("model.name is required")

        provider_manager = ProviderManager()
        models = provider_manager.get_configurations(tenant_id).get_models(
            provider=config["model"]["provider"],
            model_type=ModelType.LLM
        )
        if not models:
            raise ValueError("model.name must be in the specified model list")

        model_ids = [m.model for m in models]
        if config["model"]["name"] not in model_ids:
            raise ValueError("model.name must be in the specified model list")

        model_mode = None
        for model in models:
            if model.model == config["model"]["name"]:
                model_mode = model.model_properties.get(ModelPropertyKey.MODE)
                break

        # model.mode
        if model_mode:
            config['model']["mode"] = model_mode
        else:
            config['model']["mode"] = "completion"

        # model.completion_params
        if 'completion_params' not in config["model"]:
            raise ValueError("model.completion_params is required")

        config["model"]["completion_params"] = cls.validate_model_completion_params(
            config["model"]["completion_params"],
            config["model"]["name"]
        )

        # user_input_form
        if "user_input_form" not in config or not config["user_input_form"]:
            config["user_input_form"] = []

        if not isinstance(config["user_input_form"], list):
            raise ValueError("user_input_form must be a list of objects")

        variables = []
        for item in config["user_input_form"]:
            key = list(item.keys())[0]
            if key not in ["text-input", "select", "paragraph", "external_data_tool"]:
                raise ValueError("Keys in user_input_form list can only be 'text-input', 'paragraph'  or 'select'")

            form_item = item[key]
            if 'label' not in form_item:
                raise ValueError("label is required in user_input_form")

            if not isinstance(form_item["label"], str):
                raise ValueError("label in user_input_form must be of string type")

            if 'variable' not in form_item:
                raise ValueError("variable is required in user_input_form")

            if not isinstance(form_item["variable"], str):
                raise ValueError("variable in user_input_form must be of string type")

            pattern = re.compile(r"^(?!\d)[\u4e00-\u9fa5A-Za-z0-9_\U0001F300-\U0001F64F\U0001F680-\U0001F6FF]{1,100}$")
            if pattern.match(form_item["variable"]) is None:
                raise ValueError("variable in user_input_form must be a string, "
                                 "and cannot start with a number")

            variables.append(form_item["variable"])

            if 'required' not in form_item or not form_item["required"]:
                form_item["required"] = False

            if not isinstance(form_item["required"], bool):
                raise ValueError("required in user_input_form must be of boolean type")

            if key == "select":
                if 'options' not in form_item or not form_item["options"]:
                    form_item["options"] = []

                if not isinstance(form_item["options"], list):
                    raise ValueError("options in user_input_form must be a list of strings")

                if "default" in form_item and form_item['default'] \
                        and form_item["default"] not in form_item["options"]:
                    raise ValueError("default value in user_input_form must be in the options list")

        # pre_prompt
        if "pre_prompt" not in config or not config["pre_prompt"]:
            config["pre_prompt"] = ""

        if not isinstance(config["pre_prompt"], str):
            raise ValueError("pre_prompt must be of string type")

        # agent_mode
        if "agent_mode" not in config or not config["agent_mode"]:
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

        if "strategy" not in config["agent_mode"] or not config["agent_mode"]["strategy"]:
            config["agent_mode"]["strategy"] = PlanningStrategy.ROUTER.value

        if config["agent_mode"]["strategy"] not in [member.value for member in list(PlanningStrategy.__members__.values())]:
            raise ValueError("strategy in agent_mode must be in the specified strategy list")

        if "tools" not in config["agent_mode"] or not config["agent_mode"]["tools"]:
            config["agent_mode"]["tools"] = []

        if not isinstance(config["agent_mode"]["tools"], list):
            raise ValueError("tools in agent_mode must be a list of objects")

        for tool in config["agent_mode"]["tools"]:
            key = list(tool.keys())[0]
            if key in SUPPORT_TOOLS:
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

                    if not cls.is_dataset_exists(account, tool_item["id"]):
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

        # dataset_query_variable
        cls.is_dataset_query_variable_valid(config, app_mode)

        # advanced prompt validation
        cls.is_advanced_prompt_valid(config, app_mode)

        # external data tools validation
        cls.is_external_data_tools_valid(tenant_id, config)

        # moderation validation
        cls.is_moderation_valid(tenant_id, config)

        # file upload validation
        cls.is_file_upload_valid(config)

        # Filter out extra parameters
        filtered_config = {
            "opening_statement": config["opening_statement"],
            "suggested_questions": config["suggested_questions"],
            "suggested_questions_after_answer": config["suggested_questions_after_answer"],
            "speech_to_text": config["speech_to_text"],
            "text_to_speech": config["text_to_speech"],
            "retriever_resource": config["retriever_resource"],
            "more_like_this": config["more_like_this"],
            "sensitive_word_avoidance": config["sensitive_word_avoidance"],
            "external_data_tools": config["external_data_tools"],
            "model": {
                "provider": config["model"]["provider"],
                "name": config["model"]["name"],
                "mode": config['model']["mode"],
                "completion_params": config["model"]["completion_params"]
            },
            "user_input_form": config["user_input_form"],
            "dataset_query_variable": config.get('dataset_query_variable'),
            "pre_prompt": config["pre_prompt"],
            "agent_mode": config["agent_mode"],
            "prompt_type": config["prompt_type"],
            "chat_prompt_config": config["chat_prompt_config"],
            "completion_prompt_config": config["completion_prompt_config"],
            "dataset_configs": config["dataset_configs"],
            "file_upload": config["file_upload"]
        }

        return filtered_config

    @classmethod
    def is_moderation_valid(cls, tenant_id: str, config: dict):
        if 'sensitive_word_avoidance' not in config or not config["sensitive_word_avoidance"]:
            config["sensitive_word_avoidance"] = {
                "enabled": False
            }

        if not isinstance(config["sensitive_word_avoidance"], dict):
            raise ValueError("sensitive_word_avoidance must be of dict type")

        if "enabled" not in config["sensitive_word_avoidance"] or not config["sensitive_word_avoidance"]["enabled"]:
            config["sensitive_word_avoidance"]["enabled"] = False

        if not config["sensitive_word_avoidance"]["enabled"]:
            return

        if "type" not in config["sensitive_word_avoidance"] or not config["sensitive_word_avoidance"]["type"]:
            raise ValueError("sensitive_word_avoidance.type is required")

        type = config["sensitive_word_avoidance"]["type"]
        config = config["sensitive_word_avoidance"]["config"]

        ModerationFactory.validate_config(
            name=type,
            tenant_id=tenant_id,
            config=config
        )

    @classmethod
    def is_file_upload_valid(cls, config: dict):
        if 'file_upload' not in config or not config["file_upload"]:
            config["file_upload"] = {}

        if not isinstance(config["file_upload"], dict):
            raise ValueError("file_upload must be of dict type")

        # check image config
        if 'image' not in config["file_upload"] or not config["file_upload"]["image"]:
            config["file_upload"]["image"] = {"enabled": False}

        if config['file_upload']['image']['enabled']:
            number_limits = config['file_upload']['image']['number_limits']
            if number_limits < 1 or number_limits > 6:
                raise ValueError("number_limits must be in [1, 6]")

            detail = config['file_upload']['image']['detail']
            if detail not in ['high', 'low']:
                raise ValueError("detail must be in ['high', 'low']")

            transfer_methods = config['file_upload']['image']['transfer_methods']
            if not isinstance(transfer_methods, list):
                raise ValueError("transfer_methods must be of list type")
            for method in transfer_methods:
                if method not in ['remote_url', 'local_file']:
                    raise ValueError("transfer_methods must be in ['remote_url', 'local_file']")

    @classmethod
    def is_external_data_tools_valid(cls, tenant_id: str, config: dict):
        if 'external_data_tools' not in config or not config["external_data_tools"]:
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

            type = tool["type"]
            config = tool["config"]

            ExternalDataToolFactory.validate_config(
                name=type,
                tenant_id=tenant_id,
                config=config
            )

    @classmethod
    def is_dataset_query_variable_valid(cls, config: dict, mode: str) -> None:
        # Only check when mode is completion
        if mode != 'completion':
            return

        agent_mode = config.get("agent_mode", {})
        tools = agent_mode.get("tools", [])
        dataset_exists = "dataset" in str(tools)

        dataset_query_variable = config.get("dataset_query_variable")

        if dataset_exists and not dataset_query_variable:
            raise ValueError("Dataset query variable is required when dataset is exist")

    @classmethod
    def is_advanced_prompt_valid(cls, config: dict, app_mode: str) -> None:
        # prompt_type
        if 'prompt_type' not in config or not config["prompt_type"]:
            config["prompt_type"] = "simple"

        if config['prompt_type'] not in ['simple', 'advanced']:
            raise ValueError("prompt_type must be in ['simple', 'advanced']")

        # chat_prompt_config
        if 'chat_prompt_config' not in config or not config["chat_prompt_config"]:
            config["chat_prompt_config"] = {}

        if not isinstance(config["chat_prompt_config"], dict):
            raise ValueError("chat_prompt_config must be of object type")

        # completion_prompt_config
        if 'completion_prompt_config' not in config or not config["completion_prompt_config"]:
            config["completion_prompt_config"] = {}

        if not isinstance(config["completion_prompt_config"], dict):
            raise ValueError("completion_prompt_config must be of object type")

        # dataset_configs
        if 'dataset_configs' not in config or not config["dataset_configs"]:
            config["dataset_configs"] = {'retrieval_model': 'single'}

        if 'datasets' not in config["dataset_configs"] or not config["dataset_configs"]["datasets"]:
            config["dataset_configs"]["datasets"] = {
                "strategy": "router",
                "datasets": []
            }

        if not isinstance(config["dataset_configs"], dict):
            raise ValueError("dataset_configs must be of object type")

        if config["dataset_configs"]['retrieval_model'] == 'multiple':
            if not config["dataset_configs"]['reranking_model']:
                raise ValueError("reranking_model has not been set")
            if not isinstance(config["dataset_configs"]['reranking_model'], dict):
                raise ValueError("reranking_model must be of object type")

        if not isinstance(config["dataset_configs"], dict):
            raise ValueError("dataset_configs must be of object type")

        if config['prompt_type'] == 'advanced':
            if not config['chat_prompt_config'] and not config['completion_prompt_config']:
                raise ValueError("chat_prompt_config or completion_prompt_config is required when prompt_type is advanced")

            if config['model']["mode"] not in ['chat', 'completion']:
                raise ValueError("model.mode must be in ['chat', 'completion'] when prompt_type is advanced")

            if app_mode == AppMode.CHAT.value and config['model']["mode"] == "completion":
                user_prefix = config['completion_prompt_config']['conversation_histories_role']['user_prefix']
                assistant_prefix = config['completion_prompt_config']['conversation_histories_role']['assistant_prefix']

                if not user_prefix:
                    config['completion_prompt_config']['conversation_histories_role']['user_prefix'] = 'Human'

                if not assistant_prefix:
                    config['completion_prompt_config']['conversation_histories_role']['assistant_prefix'] = 'Assistant'

            if config['model']["mode"] == "chat":
                prompt_list = config['chat_prompt_config']['prompt']

                if len(prompt_list) > 10:
                    raise ValueError("prompt messages must be less than 10")
