import re
import uuid

from core.constant import llm_constant
from models.account import Account
from services.dataset_service import DatasetService
from core.llm.llm_builder import LLMBuilder

MODEL_PROVIDERS = [
    'openai',
    'anthropic',
]

MODELS_BY_APP_MODE = {
    'chat': [
        'claude-instant-1',
        'claude-2',
        'gpt-4',
        'gpt-4-32k',
        'gpt-3.5-turbo',
        'gpt-3.5-turbo-16k',
    ],
    'completion': [
        'claude-instant-1',
        'claude-2',
        'gpt-4',
        'gpt-4-32k',
        'gpt-3.5-turbo',
        'gpt-3.5-turbo-16k',
        'text-davinci-003',
    ]
}

class AppModelConfigService:
    @staticmethod
    def is_dataset_exists(account: Account, dataset_id: str) -> bool:
        # verify if the dataset ID exists
        dataset = DatasetService.get_dataset(dataset_id)

        if not dataset:
            return False

        if dataset.tenant_id != account.current_tenant_id:
            return False

        return True

    @staticmethod
    def validate_model_completion_params(cp: dict, model_name: str) -> dict:
        # 6. model.completion_params
        if not isinstance(cp, dict):
            raise ValueError("model.completion_params must be of object type")

        # max_tokens
        if 'max_tokens' not in cp:
            cp["max_tokens"] = 512

        if not isinstance(cp["max_tokens"], int) or cp["max_tokens"] <= 0 or cp["max_tokens"] > \
                llm_constant.max_context_token_length[model_name]:
            raise ValueError(
                "max_tokens must be an integer greater than 0 and not exceeding the maximum value of the corresponding model")

        # temperature
        if 'temperature' not in cp:
            cp["temperature"] = 1

        if not isinstance(cp["temperature"], (float, int)) or cp["temperature"] < 0 or cp["temperature"] > 2:
            raise ValueError("temperature must be a float between 0 and 2")

        # top_p
        if 'top_p' not in cp:
            cp["top_p"] = 1

        if not isinstance(cp["top_p"], (float, int)) or cp["top_p"] < 0 or cp["top_p"] > 2:
            raise ValueError("top_p must be a float between 0 and 2")

        # presence_penalty
        if 'presence_penalty' not in cp:
            cp["presence_penalty"] = 0

        if not isinstance(cp["presence_penalty"], (float, int)) or cp["presence_penalty"] < -2 or cp["presence_penalty"] > 2:
            raise ValueError("presence_penalty must be a float between -2 and 2")

        # presence_penalty
        if 'frequency_penalty' not in cp:
            cp["frequency_penalty"] = 0

        if not isinstance(cp["frequency_penalty"], (float, int)) or cp["frequency_penalty"] < -2 or cp["frequency_penalty"] > 2:
            raise ValueError("frequency_penalty must be a float between -2 and 2")

        # Filter out extra parameters
        filtered_cp = {
            "max_tokens": cp["max_tokens"],
            "temperature": cp["temperature"],
            "top_p": cp["top_p"],
            "presence_penalty": cp["presence_penalty"],
            "frequency_penalty": cp["frequency_penalty"]
        }

        return filtered_cp

    @staticmethod
    def validate_configuration(account: Account, config: dict, mode: str) -> dict:
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
        
        provider_name = LLMBuilder.get_default_provider(account.current_tenant_id, 'whisper-1')

        if config["speech_to_text"]["enabled"] and provider_name != 'openai':
            raise ValueError("provider not support speech to text")

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
        if 'provider' not in config["model"] or config["model"]["provider"] not in MODEL_PROVIDERS:
            raise ValueError(f"model.provider is required and must be in {str(MODEL_PROVIDERS)}")

        # model.name
        if 'name' not in config["model"]:
            raise ValueError("model.name is required")

        if config["model"]["name"] not in MODELS_BY_APP_MODE[mode]:
            raise ValueError("model.name must be in the specified model list")

        # model.completion_params
        if 'completion_params' not in config["model"]:
            raise ValueError("model.completion_params is required")

        config["model"]["completion_params"] = AppModelConfigService.validate_model_completion_params(
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
            if key not in ["text-input", "select"]:
                raise ValueError("Keys in user_input_form list can only be 'text-input' or 'select'")

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

        template_vars = re.findall(r"\{\{(\w+)\}\}", config["pre_prompt"])
        for var in template_vars:
            if var not in variables:
                raise ValueError("Template variables in pre_prompt must be defined in user_input_form")

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

        if "tools" not in config["agent_mode"] or not config["agent_mode"]["tools"]:
            config["agent_mode"]["tools"] = []

        if not isinstance(config["agent_mode"]["tools"], list):
            raise ValueError("tools in agent_mode must be a list of objects")

        for tool in config["agent_mode"]["tools"]:
            key = list(tool.keys())[0]
            if key not in ["sensitive-word-avoidance", "dataset"]:
                raise ValueError("Keys in agent_mode.tools list can only be 'sensitive-word-avoidance' or 'dataset'")

            tool_item = tool[key]

            if "enabled" not in tool_item or not tool_item["enabled"]:
                tool_item["enabled"] = False

            if not isinstance(tool_item["enabled"], bool):
                raise ValueError("enabled in agent_mode.tools must be of boolean type")

            if key == "sensitive-word-avoidance":
                if "words" not in tool_item or not tool_item["words"]:
                    tool_item["words"] = ""

                if not isinstance(tool_item["words"], str):
                    raise ValueError("words in sensitive-word-avoidance must be of string type")

                if "canned_response" not in tool_item or not tool_item["canned_response"]:
                    tool_item["canned_response"] = ""

                if not isinstance(tool_item["canned_response"], str):
                    raise ValueError("canned_response in sensitive-word-avoidance must be of string type")
            elif key == "dataset":
                if 'id' not in tool_item:
                    raise ValueError("id is required in dataset")

                try:
                    uuid.UUID(tool_item["id"])
                except ValueError:
                    raise ValueError("id in dataset must be of UUID type")

                if not AppModelConfigService.is_dataset_exists(account, tool_item["id"]):
                    raise ValueError("Dataset ID does not exist, please check your permission.")

        # Filter out extra parameters
        filtered_config = {
            "opening_statement": config["opening_statement"],
            "suggested_questions": config["suggested_questions"],
            "suggested_questions_after_answer": config["suggested_questions_after_answer"],
            "speech_to_text": config["speech_to_text"],
            "more_like_this": config["more_like_this"],
            "model": {
                "provider": config["model"]["provider"],
                "name": config["model"]["name"],
                "completion_params": config["model"]["completion_params"]
            },
            "user_input_form": config["user_input_form"],
            "pre_prompt": config["pre_prompt"],
            "agent_mode": config["agent_mode"]
        }

        return filtered_config
