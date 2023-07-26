from typing import List, Optional, Any, Dict

from httpx import Timeout
from langchain.callbacks.manager import Callbacks
from langchain.chat_models import ChatAnthropic
from langchain.schema import BaseMessage, LLMResult, SystemMessage, AIMessage, HumanMessage, ChatMessage
from pydantic import root_validator

from core.llm.wrappers.anthropic_wrapper import handle_anthropic_exceptions


class StreamableChatAnthropic(ChatAnthropic):
    """
    Wrapper around Anthropic's large language model.
    """

    default_request_timeout: Optional[float] = Timeout(timeout=300.0, connect=5.0)

    @root_validator()
    def prepare_params(cls, values: Dict) -> Dict:
        values['model_name'] = values.get('model')
        values['max_tokens'] = values.get('max_tokens_to_sample')
        return values

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

    def _convert_one_message_to_text(self, message: BaseMessage) -> str:
        if isinstance(message, ChatMessage):
            message_text = f"\n\n{message.role.capitalize()}: {message.content}"
        elif isinstance(message, HumanMessage):
            message_text = f"{self.HUMAN_PROMPT} {message.content}"
        elif isinstance(message, AIMessage):
            message_text = f"{self.AI_PROMPT} {message.content}"
        elif isinstance(message, SystemMessage):
            message_text = f"<admin>{message.content}</admin>"
        else:
            raise ValueError(f"Got unknown type {message}")
        return message_text