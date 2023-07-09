from typing import cast, List

from langchain import OpenAI
from langchain.base_language import BaseLanguageModel
from langchain.chat_models.openai import ChatOpenAI
from langchain.schema import BaseMessage


class CalcTokenMixin:

    def get_num_tokens_from_messages(self, llm: BaseLanguageModel, messages: List[BaseMessage], **kwargs) -> int:
        llm = cast(ChatOpenAI, llm)
        return llm.get_num_tokens_from_messages(messages)

    def get_message_rest_tokens(self, llm: BaseLanguageModel, messages: List[BaseMessage], **kwargs) -> int:
        """
        Got the rest tokens available for the model after excluding messages tokens and completion max tokens

        :param llm:
        :param messages:
        :return:
        """
        llm = cast(ChatOpenAI, llm)
        llm_max_tokens = OpenAI.modelname_to_contextsize(llm.model_name)
        completion_max_tokens = llm.max_tokens
        used_tokens = self.get_num_tokens_from_messages(llm, messages, **kwargs)
        rest_tokens = llm_max_tokens - completion_max_tokens - used_tokens

        return rest_tokens


class ExceededLLMTokensLimitError(Exception):
    pass
