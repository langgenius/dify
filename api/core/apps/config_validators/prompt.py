from typing import Tuple

from core.entities.application_entities import PromptTemplateEntity
from core.prompt.simple_prompt_transform import ModelMode
from models.model import AppMode


class PromptValidator:
    @classmethod
    def validate_and_set_defaults(cls, app_mode: AppMode, config: dict) -> Tuple[dict, list[str]]:
        """
        Validate pre_prompt and set defaults for prompt feature
        depending on the config['model']

        :param app_mode: app mode
        :param config: app model config args
        """
        if not config.get("prompt_type"):
            config["prompt_type"] = PromptTemplateEntity.PromptType.SIMPLE.value

        prompt_type_vals = [typ.value for typ in PromptTemplateEntity.PromptType]
        if config['prompt_type'] not in prompt_type_vals:
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

        if config['prompt_type'] == PromptTemplateEntity.PromptType.ADVANCED.value:
            if not config['chat_prompt_config'] and not config['completion_prompt_config']:
                raise ValueError("chat_prompt_config or completion_prompt_config is required "
                                 "when prompt_type is advanced")

            model_mode_vals = [mode.value for mode in ModelMode]
            if config['model']["mode"] not in model_mode_vals:
                raise ValueError(f"model.mode must be in {model_mode_vals} when prompt_type is advanced")

            if app_mode == AppMode.CHAT and config['model']["mode"] == ModelMode.COMPLETION.value:
                user_prefix = config['completion_prompt_config']['conversation_histories_role']['user_prefix']
                assistant_prefix = config['completion_prompt_config']['conversation_histories_role']['assistant_prefix']

                if not user_prefix:
                    config['completion_prompt_config']['conversation_histories_role']['user_prefix'] = 'Human'

                if not assistant_prefix:
                    config['completion_prompt_config']['conversation_histories_role']['assistant_prefix'] = 'Assistant'

            if config['model']["mode"] == ModelMode.CHAT.value:
                prompt_list = config['chat_prompt_config']['prompt']

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