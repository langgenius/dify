
import copy

from core.prompt.advanced_prompt_templates import (
    BAICHUAN_CHAT_APP_CHAT_PROMPT_CONFIG,
    BAICHUAN_CHAT_APP_COMPLETION_PROMPT_CONFIG,
    BAICHUAN_COMPLETION_APP_CHAT_PROMPT_CONFIG,
    BAICHUAN_COMPLETION_APP_COMPLETION_PROMPT_CONFIG,
    BAICHUAN_CONTEXT,
    CHAT_APP_CHAT_PROMPT_CONFIG,
    CHAT_APP_COMPLETION_PROMPT_CONFIG,
    COMPLETION_APP_CHAT_PROMPT_CONFIG,
    COMPLETION_APP_COMPLETION_PROMPT_CONFIG,
    CONTEXT,
)
from core.prompt.prompt_transform import AppMode


class AdvancedPromptTemplateService:

    @classmethod
    def get_prompt(cls, args: dict) -> dict:
        app_mode = args['app_mode']
        model_mode = args['model_mode']
        model_name = args['model_name']
        has_context = args['has_context']

        if 'baichuan' in model_name.lower():
            return cls.get_baichuan_prompt(app_mode, model_mode, has_context)
        else:
            return cls.get_common_prompt(app_mode, model_mode, has_context)

    @classmethod
    def get_common_prompt(cls, app_mode: str, model_mode:str, has_context: str) -> dict:
        context_prompt = copy.deepcopy(CONTEXT)

        if app_mode == AppMode.CHAT.value:
            if model_mode == "completion":
                return cls.get_completion_prompt(copy.deepcopy(CHAT_APP_COMPLETION_PROMPT_CONFIG), has_context, context_prompt)
            elif model_mode == "chat":
                return cls.get_chat_prompt(copy.deepcopy(CHAT_APP_CHAT_PROMPT_CONFIG), has_context, context_prompt)
        elif app_mode == AppMode.COMPLETION.value:
            if model_mode == "completion":
                return cls.get_completion_prompt(copy.deepcopy(COMPLETION_APP_COMPLETION_PROMPT_CONFIG), has_context, context_prompt)
            elif model_mode == "chat":
                return cls.get_chat_prompt(copy.deepcopy(COMPLETION_APP_CHAT_PROMPT_CONFIG), has_context, context_prompt)
            
    @classmethod
    def get_completion_prompt(cls, prompt_template: dict, has_context: str, context: str) -> dict:
        if has_context == 'true':
            prompt_template['completion_prompt_config']['prompt']['text'] = context + prompt_template['completion_prompt_config']['prompt']['text']
        
        return prompt_template

    @classmethod
    def get_chat_prompt(cls, prompt_template: dict, has_context: str, context: str) -> dict:
        if has_context == 'true':
            prompt_template['chat_prompt_config']['prompt'][0]['text'] = context + prompt_template['chat_prompt_config']['prompt'][0]['text']
        
        return prompt_template

    @classmethod
    def get_baichuan_prompt(cls, app_mode: str, model_mode:str, has_context: str) -> dict:
        baichuan_context_prompt = copy.deepcopy(BAICHUAN_CONTEXT)

        if app_mode == AppMode.CHAT.value:
            if model_mode == "completion":
                return cls.get_completion_prompt(copy.deepcopy(BAICHUAN_CHAT_APP_COMPLETION_PROMPT_CONFIG), has_context, baichuan_context_prompt)
            elif model_mode == "chat":
                return cls.get_chat_prompt(copy.deepcopy(BAICHUAN_CHAT_APP_CHAT_PROMPT_CONFIG), has_context, baichuan_context_prompt)
        elif app_mode == AppMode.COMPLETION.value:
            if model_mode == "completion":
                return cls.get_completion_prompt(copy.deepcopy(BAICHUAN_COMPLETION_APP_COMPLETION_PROMPT_CONFIG), has_context, baichuan_context_prompt)
            elif model_mode == "chat":
                return cls.get_chat_prompt(copy.deepcopy(BAICHUAN_COMPLETION_APP_CHAT_PROMPT_CONFIG), has_context, baichuan_context_prompt)