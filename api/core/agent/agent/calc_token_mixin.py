from typing import List

from langchain.schema import BaseMessage

from core.model_providers.models.entity.message import to_prompt_messages
from core.model_providers.models.llm.base import BaseLLM


class CalcTokenMixin:

    def get_num_tokens_from_messages(self, model_instance: BaseLLM, messages: List[BaseMessage], **kwargs) -> int:
        return model_instance.get_num_tokens(to_prompt_messages(messages))

    def get_message_rest_tokens(self, model_instance: BaseLLM, messages: List[BaseMessage], **kwargs) -> int:
        """
        Got the rest tokens available for the model after excluding messages tokens and completion max tokens

        :param llm:
        :param messages:
        :return:
        """
        llm_max_tokens = model_instance.model_rules.max_tokens.max
        completion_max_tokens = model_instance.model_kwargs.max_tokens
        used_tokens = self.get_num_tokens_from_messages(model_instance, messages, **kwargs)
        rest_tokens = llm_max_tokens - completion_max_tokens - used_tokens

        return rest_tokens


class ExceededLLMTokensLimitError(Exception):
    pass
