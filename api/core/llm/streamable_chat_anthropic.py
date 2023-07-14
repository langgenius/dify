from typing import List, Optional, Any, Dict

from langchain.callbacks.manager import Callbacks
from langchain.chat_models import ChatAnthropic
from langchain.schema import BaseMessage, LLMResult

from core.llm.wrappers.anthropic_wrapper import handle_anthropic_exceptions


class StreamableChatAnthropic(ChatAnthropic):
    """
    Wrapper around Anthropic's large language model.
    """

    @handle_anthropic_exceptions
    def generate(
            self,
            messages: List[List[BaseMessage]],
            stop: Optional[List[str]] = None,
            callbacks: Callbacks = None,
            *,
            tags: Optional[List[str]] = None,
            metadata: Optional[Dict[str, Any]] = None,
            **kwargs: Any,
    ) -> LLMResult:
        return super().generate(messages, stop, callbacks, tags=tags, metadata=metadata, **kwargs)

    @classmethod
    def get_kwargs_from_model_params(cls, params: dict):
        params['model'] = params.get('model_name')
        del params['model_name']

        params['max_tokens_to_sample'] = params.get('max_tokens')
        del params['max_tokens']

        del params['frequency_penalty']
        del params['presence_penalty']

        return params
