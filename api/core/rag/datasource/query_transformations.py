import logging

from flask_login import current_user
from werkzeug.exceptions import Forbidden

from core.model_manager import ModelManager
from core.model_runtime.entities.message_entities import UserPromptMessage
from core.model_runtime.entities.model_entities import ModelType
from core.model_runtime.errors.invoke import InvokeError


class QueryTransformationService:
    @classmethod
    def hyde(cls, query):
        if not current_user.is_admin_or_owner:
            raise Forbidden()
        
        model_manager = ModelManager()
        model_instance = model_manager.get_default_model_instance(
            tenant_id=current_user.current_tenant_id,
            model_type=ModelType.LLM,
        )
        
        prompt = f'请你认真思考后回答这个问题：{query}' # 后续把 prompt 做封装。
        
        prompts = [UserPromptMessage(content=prompt)]
        try:
            response = model_instance.invoke_llm(
                prompt_messages=prompts,
                model_parameters={
                    "max_tokens": 200,
                    "temperature": 1
                },
                stream=False
            )
            answer = response.message.content
        except InvokeError:
            answer = []
        except Exception as e:
            logging.exception(e)
            answer = []
            
        return answer