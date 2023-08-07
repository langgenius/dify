from typing import Optional, List

from langchain.callbacks.base import BaseCallbackHandler
from langchain.schema.language_model import BaseLanguageModel

from core.model_providers.model_factory import ModelFactory
from core.model_providers.models.entity.model_params import ModelKwargs


class LLMBuilder:

    @classmethod
    def to_llm(cls, tenant_id: str, provider_name: str, model_name: str, **kwargs) -> BaseLanguageModel:
        model_instance = ModelFactory.get_text_generation_model(
            tenant_id=tenant_id,
            model_provider_name=provider_name,
            model_name=model_name,
            model_kwargs=ModelKwargs(
                temperature=kwargs.get('temperature', 0),
                max_tokens=kwargs.get('max_tokens', 256),
                top_p=kwargs.get('top_p', 1),
                frequency_penalty=kwargs.get('frequency_penalty', 0),
                presence_penalty=kwargs.get('presence_penalty', 0),
            ),
            streaming=kwargs.get('streaming', False),
            callbacks=kwargs.get('callbacks', None)
        )

        return model_instance.client

    @classmethod
    def to_llm_from_model(cls, tenant_id: str, model: dict, streaming: bool = False,
                          callbacks: Optional[List[BaseCallbackHandler]] = None) -> BaseLanguageModel:
        provider_name = model.get("provider")
        model_name = model.get("name")
        completion_params = model.get("completion_params", {})

        return cls.to_llm(
            tenant_id=tenant_id,
            provider_name=provider_name,
            model_name=model_name,
            temperature=completion_params.get('temperature', 0),
            max_tokens=completion_params.get('max_tokens', 256),
            top_p=completion_params.get('top_p', 0),
            frequency_penalty=completion_params.get('frequency_penalty', 0.1),
            presence_penalty=completion_params.get('presence_penalty', 0.1),
            streaming=streaming,
            callbacks=callbacks
        )
