
from core.prompt.advanced_prompt_templates import CHAT_APP_COMPLETION_PROMPT_CONFIG, CHAT_APP_CHAT_PROMPT_CONFIG, COMPLETION_APP_CHAT_PROMPT_CONFIG, COMPLETION_APP_COMPLETION_PROMPT_CONFIG, \
    BAICHUAN_CHAT_APP_COMPLETION_PROMPT_CONFIG, BAICHUAN_CHAT_APP_CHAT_PROMPT_CONFIG, BAICHUAN_COMPLETION_APP_COMPLETION_PROMPT_CONFIG, BAICHUAN_COMPLETION_APP_CHAT_PROMPT_CONFIG

class AdvancedPromptTemplateService:

    @staticmethod
    def get_prompt(args: dict):
        app_mode = args['app_mode']
        model_mode = args['model_mode']
        model_name = args['model_name']

        if 'baichuan' in model_name:
            return AdvancedPromptTemplateService.get_baichuan_prompt(app_mode, model_mode)
        else:
            return AdvancedPromptTemplateService.get_common_prompt(app_mode, model_mode)

    @staticmethod
    def get_common_prompt(app_mode: str, model_mode:str):
        if app_mode == 'chat':
            if model_mode == 'completion':
                return CHAT_APP_COMPLETION_PROMPT_CONFIG
            elif model_mode == 'chat':
                return CHAT_APP_CHAT_PROMPT_CONFIG
        elif app_mode == 'completion':
            if model_mode == 'completion':
                return COMPLETION_APP_COMPLETION_PROMPT_CONFIG
            elif model_mode == 'chat':
                return COMPLETION_APP_CHAT_PROMPT_CONFIG

    @staticmethod
    def get_baichuan_prompt(app_mode: str, model_mode:str):
        if app_mode == 'chat':
            if model_mode == 'completion':
                return BAICHUAN_CHAT_APP_COMPLETION_PROMPT_CONFIG
            elif model_mode == 'chat':
                return BAICHUAN_CHAT_APP_CHAT_PROMPT_CONFIG
        elif app_mode == 'completion':
            if model_mode == 'completion':
                return BAICHUAN_COMPLETION_APP_COMPLETION_PROMPT_CONFIG
            elif model_mode == 'chat':
                return BAICHUAN_COMPLETION_APP_CHAT_PROMPT_CONFIG