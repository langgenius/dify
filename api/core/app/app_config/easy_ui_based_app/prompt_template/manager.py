from core.app.app_config.entities import (
    AdvancedChatMessageEntity,
    AdvancedChatPromptTemplateEntity,
    AdvancedCompletionPromptTemplateEntity,
    PromptTemplateEntity,
)
from core.model_runtime.entities.message_entities import PromptMessageRole
from core.prompt.simple_prompt_transform import ModelMode
from models.model import AppMode


class PromptTemplateConfigManager:
    @classmethod
    def convert(cls, config: dict) -> PromptTemplateEntity:
        if not config.get("prompt_type"):
            raise ValueError("prompt_type is required")

        prompt_type = PromptTemplateEntity.PromptType.value_of(config["prompt_type"])
        if prompt_type == PromptTemplateEntity.PromptType.SIMPLE:
            simple_prompt_template = config.get("pre_prompt", "")
            return PromptTemplateEntity(prompt_type=prompt_type, simple_prompt_template=simple_prompt_template)
        else:
            advanced_chat_prompt_template = None
            chat_prompt_config = config.get("chat_prompt_config", {})
            if chat_prompt_config:
                chat_prompt_messages = []
                for message in chat_prompt_config.get("prompt", []):
                    chat_prompt_messages.append(
                        AdvancedChatMessageEntity(
                            **{"text": message["text"], "role": PromptMessageRole.value_of(message["role"])}
                        )
                    )

                advanced_chat_prompt_template = AdvancedChatPromptTemplateEntity(messages=chat_prompt_messages)

            advanced_completion_prompt_template = None
            completion_prompt_config = config.get("completion_prompt_config", {})
            if completion_prompt_config:
                completion_prompt_template_params = {
                    "prompt": completion_prompt_config["prompt"]["text"],
                }

                if "conversation_histories_role" in completion_prompt_config:
                    completion_prompt_template_params["role_prefix"] = {
                        "user": completion_prompt_config["conversation_histories_role"]["user_prefix"],
                        "assistant": completion_prompt_config["conversation_histories_role"]["assistant_prefix"],
                    }

                advanced_completion_prompt_template = AdvancedCompletionPromptTemplateEntity(
                    **completion_prompt_template_params
                )

            return PromptTemplateEntity(
                prompt_type=prompt_type,
                advanced_chat_prompt_template=advanced_chat_prompt_template,
                advanced_completion_prompt_template=advanced_completion_prompt_template,
            )

    @classmethod
    def validate_and_set_defaults(cls, app_mode: AppMode, config: dict) -> tuple[dict, list[str]]:
        """
        Validate pre_prompt and set defaults for prompt feature
        depending on the config['model']

        :param app_mode: app mode
        :param config: app model config args
        """
        if not config.get("prompt_type"):
            config["prompt_type"] = PromptTemplateEntity.PromptType.SIMPLE.value

        prompt_type_vals = [typ.value for typ in PromptTemplateEntity.PromptType]
        if config["prompt_type"] not in prompt_type_vals:
            raise ValueError(f"prompt_type must be in {prompt_type_vals}")

        # chat_prompt_config
        if not config.get("chat_prompt_config"):
            config["chat_prompt_config"] = {}

        if not isinstance(config["chat_prompt_config"], dict):
            raise ValueError("chat_prompt_config must be of object type")

        # completion_prompt_config
        if not config.get("completion_prompt_config"):
            config["completion_prompt_config"] = {}

        if not isinstance(config["completion_prompt_config"], dict):
            raise ValueError("completion_prompt_config must be of object type")

        if config["prompt_type"] == PromptTemplateEntity.PromptType.ADVANCED.value:
            if not config["chat_prompt_config"] and not config["completion_prompt_config"]:
                raise ValueError(
                    "chat_prompt_config or completion_prompt_config is required when prompt_type is advanced"
                )

            model_mode_vals = [mode.value for mode in ModelMode]
            if config["model"]["mode"] not in model_mode_vals:
                raise ValueError(f"model.mode must be in {model_mode_vals} when prompt_type is advanced")

            if app_mode == AppMode.CHAT and config["model"]["mode"] == ModelMode.COMPLETION.value:
                user_prefix = config["completion_prompt_config"]["conversation_histories_role"]["user_prefix"]
                assistant_prefix = config["completion_prompt_config"]["conversation_histories_role"]["assistant_prefix"]

                if not user_prefix:
                    config["completion_prompt_config"]["conversation_histories_role"]["user_prefix"] = "Human"

                if not assistant_prefix:
                    config["completion_prompt_config"]["conversation_histories_role"]["assistant_prefix"] = "Assistant"

            if config["model"]["mode"] == ModelMode.CHAT.value:
                prompt_list = config["chat_prompt_config"]["prompt"]

                if len(prompt_list) > 10:
                    raise ValueError("prompt messages must be less than 10")
        else:
            # pre_prompt, for simple mode
            if not config.get("pre_prompt"):
                config["pre_prompt"] = ""

            if not isinstance(config["pre_prompt"], str):
                raise ValueError("pre_prompt must be of string type")

        return config, ["prompt_type", "pre_prompt", "chat_prompt_config", "completion_prompt_config"]

    @classmethod
    def validate_post_prompt_and_set_defaults(cls, config: dict) -> dict:
        """
        Validate post_prompt and set defaults for prompt feature

        :param config: app model config args
        """
        # post_prompt
        if not config.get("post_prompt"):
            config["post_prompt"] = ""

        if not isinstance(config["post_prompt"], str):
            raise ValueError("post_prompt must be of string type")

        return config
