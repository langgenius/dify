import requests
from langchain.schema import BaseMessage, ChatResult, LLMResult
from langchain.chat_models import AzureChatOpenAI
from typing import Optional, List

from core.llm.error_handle_wraps import handle_llm_exceptions, handle_llm_exceptions_async


class StreamableAzureChatOpenAI(AzureChatOpenAI):
    def get_messages_tokens(self, messages: List[BaseMessage]) -> int:
        """Get the number of tokens in a list of messages.

        Args:
            messages: The messages to count the tokens of.

        Returns:
            The number of tokens in the messages.
        """
        tokens_per_message = 5
        tokens_per_request = 3

        message_tokens = tokens_per_request
        message_strs = ''
        for message in messages:
            message_strs += message.content
            message_tokens += tokens_per_message

        # calc once
        message_tokens += self.get_num_tokens(message_strs)

        return message_tokens

    def _generate(
            self, messages: List[BaseMessage], stop: Optional[List[str]] = None
    ) -> ChatResult:
        self.callback_manager.on_llm_start(
            {"name": self.__class__.__name__}, [(message.type + ": " + message.content) for message in messages],
            verbose=self.verbose
        )

        chat_result = super()._generate(messages, stop)

        result = LLMResult(
            generations=[chat_result.generations],
            llm_output=chat_result.llm_output
        )
        self.callback_manager.on_llm_end(result, verbose=self.verbose)

        return chat_result

    async def _agenerate(
            self, messages: List[BaseMessage], stop: Optional[List[str]] = None
    ) -> ChatResult:
        if self.callback_manager.is_async:
            await self.callback_manager.on_llm_start(
                {"name": self.__class__.__name__}, [(message.type + ": " + message.content) for message in messages],
                verbose=self.verbose
            )
        else:
            self.callback_manager.on_llm_start(
                {"name": self.__class__.__name__}, [(message.type + ": " + message.content) for message in messages],
                verbose=self.verbose
            )

        chat_result = super()._generate(messages, stop)

        result = LLMResult(
            generations=[chat_result.generations],
            llm_output=chat_result.llm_output
        )

        if self.callback_manager.is_async:
            await self.callback_manager.on_llm_end(result, verbose=self.verbose)
        else:
            self.callback_manager.on_llm_end(result, verbose=self.verbose)

        return chat_result

    @handle_llm_exceptions
    def generate(
            self, messages: List[List[BaseMessage]], stop: Optional[List[str]] = None
    ) -> LLMResult:
        return super().generate(messages, stop)

    @handle_llm_exceptions_async
    async def agenerate(
            self, messages: List[List[BaseMessage]], stop: Optional[List[str]] = None
    ) -> LLMResult:
        return await super().agenerate(messages, stop)
