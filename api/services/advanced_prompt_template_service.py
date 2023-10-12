
import copy

from core.prompt.advanced_prompt_templates import CHAT_APP_COMPLETION_PROMPT_CONFIG, CHAT_APP_CHAT_PROMPT_CONFIG, COMPLETION_APP_CHAT_PROMPT_CONFIG, COMPLETION_APP_COMPLETION_PROMPT_CONFIG, \
    BAICHUAN_CHAT_APP_COMPLETION_PROMPT_CONFIG, BAICHUAN_CHAT_APP_CHAT_PROMPT_CONFIG, BAICHUAN_COMPLETION_APP_COMPLETION_PROMPT_CONFIG, BAICHUAN_COMPLETION_APP_CHAT_PROMPT_CONFIG, CONTEXT, BAICHUAN_CONTEXT

class AdvancedPromptTemplateService:

    def get_prompt(self, args: dict) -> dict:
        app_mode = args['app_mode']
        model_mode = args['model_mode']
        model_name = args['model_name']
        has_context = args['has_context']

        if 'baichuan' in model_name:
            return self.get_baichuan_prompt(app_mode, model_mode, has_context)
        else:
            return self.get_common_prompt(app_mode, model_mode, has_context)

    def get_common_prompt(self, app_mode: str, model_mode:str, has_context: bool) -> dict:
        if app_mode == 'chat':
            if model_mode == 'completion':
                return self.get_completion_prompt(copy.deepcopy(CHAT_APP_COMPLETION_PROMPT_CONFIG), has_context, CONTEXT)
            elif model_mode == 'chat':
                return self.get_chat_prompt(copy.deepcopy(CHAT_APP_CHAT_PROMPT_CONFIG), has_context, CONTEXT)
        elif app_mode == 'completion':
            if model_mode == 'completion':
                return self.get_completion_prompt(copy.deepcopy(COMPLETION_APP_COMPLETION_PROMPT_CONFIG), has_context, CONTEXT)
            elif model_mode == 'chat':
                return self.get_chat_prompt(copy.deepcopy(COMPLETION_APP_CHAT_PROMPT_CONFIG), has_context, CONTEXT)
            
    def get_completion_prompt(self, prompt_template: str, has_context: bool, context: str) -> dict:
        if has_context == 'true':
            prompt_template['completion_prompt_config']['prompt']['text'] = context + prompt_template['completion_prompt_config']['prompt']['text']
        
        return prompt_template


    def get_chat_prompt(self, prompt_template: str, has_context: bool, context: str) -> dict:
        if has_context == 'true':
            prompt_template['chat_prompt_config']['prompt'][0]['text'] = context + prompt_template['chat_prompt_config']['prompt'][0]['text']
        
        return prompt_template


    def get_baichuan_prompt(self, app_mode: str, model_mode:str, has_context: bool) -> dict:
        if app_mode == 'chat':
            if model_mode == 'completion':
                return self.get_completion_prompt(copy.deepcopy(BAICHUAN_CHAT_APP_COMPLETION_PROMPT_CONFIG), has_context, BAICHUAN_CONTEXT)
            elif model_mode == 'chat':
                return self.get_chat_prompt(copy.deepcopy(BAICHUAN_CHAT_APP_CHAT_PROMPT_CONFIG), has_context, BAICHUAN_CONTEXT)
        elif app_mode == 'completion':
            if model_mode == 'completion':
                return self.get_completion_prompt(copy.deepcopy(BAICHUAN_COMPLETION_APP_COMPLETION_PROMPT_CONFIG), has_context, BAICHUAN_CONTEXT)
            elif model_mode == 'chat':
                return self.get_chat_prompt(copy.deepcopy(BAICHUAN_COMPLETION_APP_CHAT_PROMPT_CONFIG), has_context, BAICHUAN_CONTEXT)