"""
For some reason, model will be used in tools like WebScraperTool, WikipediaSearchTool etc.

Therefore, a model manager is needed to list/invoke/validate models.
"""

import json
from decimal import Decimal
from typing import cast

from core.model_manager import ModelManager
from core.model_runtime.entities.llm_entities import LLMResult
from core.model_runtime.entities.message_entities import PromptMessage
from core.model_runtime.entities.model_entities import ModelPropertyKey, ModelType
from core.model_runtime.errors.invoke import (
    InvokeAuthorizationError,
    InvokeBadRequestError,
    InvokeConnectionError,
    InvokeRateLimitError,
    InvokeServerUnavailableError,
)
from core.model_runtime.model_providers.__base.large_language_model import LargeLanguageModel
from core.model_runtime.utils.encoders import jsonable_encoder
from extensions.ext_database import db
from models.tools import ToolModelInvoke


class InvokeModelError(Exception):
    pass


class ModelInvocationUtils:
    @staticmethod
    def get_max_llm_context_tokens(
        tenant_id: str,
    ) -> int:
        """
        get max llm context tokens of the model
        """
        model_manager = ModelManager()
        model_instance = model_manager.get_default_model_instance(
            tenant_id=tenant_id,
            model_type=ModelType.LLM,
        )

        if not model_instance:
            raise InvokeModelError("Model not found")

        llm_model = cast(LargeLanguageModel, model_instance.model_type_instance)
        schema = llm_model.get_model_schema(model_instance.model, model_instance.credentials)

        if not schema:
            raise InvokeModelError("No model schema found")

        max_tokens: int | None = schema.model_properties.get(ModelPropertyKey.CONTEXT_SIZE, None)
        if max_tokens is None:
            return 2048

        return max_tokens

    @staticmethod
    def calculate_tokens(tenant_id: str, prompt_messages: list[PromptMessage]) -> int:
        """
        calculate tokens from prompt messages and model parameters
        """

        # get model instance
        model_manager = ModelManager()
        model_instance = model_manager.get_default_model_instance(tenant_id=tenant_id, model_type=ModelType.LLM)

        if not model_instance:
            raise InvokeModelError("Model not found")

        # get tokens
        tokens = model_instance.get_llm_num_tokens(prompt_messages)

        return tokens

    @staticmethod
    def invoke(
        user_id: str, tenant_id: str, tool_type: str, tool_name: str, prompt_messages: list[PromptMessage]
    ) -> LLMResult:
        """
        invoke model with parameters in user's own context

        :param user_id: user id
        :param tenant_id: tenant id, the tenant id of the creator of the tool
        :param tool_type: tool type
        :param tool_name: tool name
        :param prompt_messages: prompt messages
        :return: AssistantPromptMessage
        """

        # get model manager
        model_manager = ModelManager()
        # get model instance
        model_instance = model_manager.get_default_model_instance(
            tenant_id=tenant_id,
            model_type=ModelType.LLM,
        )

        # get prompt tokens
        prompt_tokens = model_instance.get_llm_num_tokens(prompt_messages)

        model_parameters = {
            "temperature": 0.8,
            "top_p": 0.8,
        }

        # create tool model invoke
        tool_model_invoke = ToolModelInvoke(
            user_id=user_id,
            tenant_id=tenant_id,
            provider=model_instance.provider,
            tool_type=tool_type,
            tool_name=tool_name,
            model_parameters=json.dumps(model_parameters),
            prompt_messages=json.dumps(jsonable_encoder(prompt_messages)),
            model_response="",
            prompt_tokens=prompt_tokens,
            answer_tokens=0,
            answer_unit_price=Decimal(),
            answer_price_unit=Decimal(),
            provider_response_latency=0,
            total_price=Decimal(),
            currency="USD",
        )

        db.session.add(tool_model_invoke)
        db.session.commit()

        try:
            response: LLMResult = model_instance.invoke_llm(
                prompt_messages=prompt_messages,
                model_parameters=model_parameters,
                tools=[],
                stop=[],
                stream=False,
                user=user_id,
                callbacks=[],
            )
        except InvokeRateLimitError as e:
            raise InvokeModelError(f"Invoke rate limit error: {e}")
        except InvokeBadRequestError as e:
            raise InvokeModelError(f"Invoke bad request error: {e}")
        except InvokeConnectionError as e:
            raise InvokeModelError(f"Invoke connection error: {e}")
        except InvokeAuthorizationError as e:
            raise InvokeModelError("Invoke authorization error")
        except InvokeServerUnavailableError as e:
            raise InvokeModelError(f"Invoke server unavailable error: {e}")
        except Exception as e:
            raise InvokeModelError(f"Invoke error: {e}")

        # update tool model invoke
        tool_model_invoke.model_response = str(response.message.content)
        if response.usage:
            tool_model_invoke.answer_tokens = response.usage.completion_tokens
            tool_model_invoke.answer_unit_price = response.usage.completion_unit_price
            tool_model_invoke.answer_price_unit = response.usage.completion_price_unit
            tool_model_invoke.provider_response_latency = response.usage.latency
            tool_model_invoke.total_price = response.usage.total_price
            tool_model_invoke.currency = response.usage.currency

        db.session.commit()

        return response
