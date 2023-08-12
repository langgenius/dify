import logging
import time
from typing import Any, Dict, List, Union

from langchain.callbacks.base import BaseCallbackHandler
from langchain.schema import LLMResult, BaseMessage

from core.callback_handler.entity.llm_message import LLMMessage
from core.conversation_message_task import ConversationMessageTask, ConversationTaskStoppedException
from core.model_providers.models.entity.message import to_prompt_messages, PromptMessage
from core.model_providers.models.llm.base import BaseLLM


class LLMCallbackHandler(BaseCallbackHandler):
    raise_error: bool = True

    def __init__(self, model_instance: BaseLLM,
                 conversation_message_task: ConversationMessageTask):
        self.model_instance = model_instance
        self.llm_message = LLMMessage()
        self.start_at = None
        self.conversation_message_task = conversation_message_task

    @property
    def always_verbose(self) -> bool:
        """Whether to call verbose callbacks even if verbose is False."""
        return True

    def on_chat_model_start(
            self,
            serialized: Dict[str, Any],
            messages: List[List[BaseMessage]],
            **kwargs: Any
    ) -> Any:
        self.start_at = time.perf_counter()
        real_prompts = []
        for message in messages[0]:
            if message.type == 'human':
                role = 'user'
            elif message.type == 'ai':
                role = 'assistant'
            else:
                role = 'system'

            real_prompts.append({
                "role": role,
                "text": message.content
            })

        self.llm_message.prompt = real_prompts
        self.llm_message.prompt_tokens = self.model_instance.get_num_tokens(to_prompt_messages(messages[0]))

    def on_llm_start(
        self, serialized: Dict[str, Any], prompts: List[str], **kwargs: Any
    ) -> None:
        self.start_at = time.perf_counter()

        self.llm_message.prompt = [{
            "role": 'user',
            "text": prompts[0]
        }]

        self.llm_message.prompt_tokens = self.model_instance.get_num_tokens([PromptMessage(content=prompts[0])])

    def on_llm_end(self, response: LLMResult, **kwargs: Any) -> None:
        end_at = time.perf_counter()
        self.llm_message.latency = end_at - self.start_at

        if not self.conversation_message_task.streaming:
            self.conversation_message_task.append_message_text(response.generations[0][0].text)
            self.llm_message.completion = response.generations[0][0].text

        self.llm_message.completion_tokens = self.model_instance.get_num_tokens([PromptMessage(content=self.llm_message.completion)])

        self.conversation_message_task.save_message(self.llm_message)

    def on_llm_new_token(self, token: str, **kwargs: Any) -> None:
        try:
            self.conversation_message_task.append_message_text(token)
        except ConversationTaskStoppedException as ex:
            self.on_llm_error(error=ex)
            raise ex

        self.llm_message.completion += token

    def on_llm_error(
            self, error: Union[Exception, KeyboardInterrupt], **kwargs: Any
    ) -> None:
        """Do nothing."""
        if isinstance(error, ConversationTaskStoppedException):
            if self.conversation_message_task.streaming:
                end_at = time.perf_counter()
                self.llm_message.latency = end_at - self.start_at
                self.llm_message.completion_tokens = self.model_instance.get_num_tokens(
                    [PromptMessage(content=self.llm_message.completion)]
                )
                self.conversation_message_task.save_message(llm_message=self.llm_message, by_stopped=True)
        else:
            logging.debug("on_llm_error: %s", error)
