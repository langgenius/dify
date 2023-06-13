import logging
import time
from typing import Any, Dict, List, Union, Optional

from langchain.callbacks.base import BaseCallbackHandler
from langchain.schema import AgentAction, AgentFinish, LLMResult, HumanMessage, AIMessage, SystemMessage

from core.callback_handler.entity.llm_message import LLMMessage
from core.conversation_message_task import ConversationMessageTask, ConversationTaskStoppedException
from core.llm.streamable_chat_open_ai import StreamableChatOpenAI
from core.llm.streamable_open_ai import StreamableOpenAI


class LLMCallbackHandler(BaseCallbackHandler):

    def __init__(self, llm: Union[StreamableOpenAI, StreamableChatOpenAI],
                 conversation_message_task: ConversationMessageTask):
        self.llm = llm
        self.llm_message = LLMMessage()
        self.start_at = None
        self.conversation_message_task = conversation_message_task

    @property
    def always_verbose(self) -> bool:
        """Whether to call verbose callbacks even if verbose is False."""
        return True

    def on_llm_start(
        self, serialized: Dict[str, Any], prompts: List[str], **kwargs: Any
    ) -> None:
        self.start_at = time.perf_counter()

        if 'Chat' in serialized['name']:
            real_prompts = []
            messages = []
            for prompt in prompts:
                role, content = prompt.split(': ', maxsplit=1)
                if role == 'human':
                    role = 'user'
                    message = HumanMessage(content=content)
                elif role == 'ai':
                    role = 'assistant'
                    message = AIMessage(content=content)
                else:
                    message = SystemMessage(content=content)

                real_prompt = {
                    "role": role,
                    "text": content
                }
                real_prompts.append(real_prompt)
                messages.append(message)

            self.llm_message.prompt = real_prompts
            self.llm_message.prompt_tokens = self.llm.get_messages_tokens(messages)
        else:
            self.llm_message.prompt = [{
                "role": 'user',
                "text": prompts[0]
            }]

            self.llm_message.prompt_tokens = self.llm.get_num_tokens(prompts[0])

    def on_llm_end(self, response: LLMResult, **kwargs: Any) -> None:
        end_at = time.perf_counter()
        self.llm_message.latency = end_at - self.start_at

        if not self.conversation_message_task.streaming:
            self.conversation_message_task.append_message_text(response.generations[0][0].text)
            self.llm_message.completion = response.generations[0][0].text
            self.llm_message.completion_tokens = response.llm_output['token_usage']['completion_tokens']
        else:
            self.llm_message.completion_tokens = self.llm.get_num_tokens(self.llm_message.completion)

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
                self.llm_message.completion_tokens = self.llm.get_num_tokens(self.llm_message.completion)
                self.conversation_message_task.save_message(llm_message=self.llm_message, by_stopped=True)
        else:
            logging.error(error)

    def on_chain_start(
            self, serialized: Dict[str, Any], inputs: Dict[str, Any], **kwargs: Any
    ) -> None:
        pass

    def on_chain_end(self, outputs: Dict[str, Any], **kwargs: Any) -> None:
        pass

    def on_chain_error(
            self, error: Union[Exception, KeyboardInterrupt], **kwargs: Any
    ) -> None:
        pass

    def on_tool_start(
            self,
            serialized: Dict[str, Any],
            input_str: str,
            **kwargs: Any,
    ) -> None:
        pass

    def on_agent_action(
            self, action: AgentAction, color: Optional[str] = None, **kwargs: Any
    ) -> Any:
        pass

    def on_tool_end(
            self,
            output: str,
            color: Optional[str] = None,
            observation_prefix: Optional[str] = None,
            llm_prefix: Optional[str] = None,
            **kwargs: Any,
    ) -> None:
        pass

    def on_tool_error(
            self, error: Union[Exception, KeyboardInterrupt], **kwargs: Any
    ) -> None:
        pass

    def on_text(
            self,
            text: str,
            color: Optional[str] = None,
            end: str = "",
            **kwargs: Optional[str],
    ) -> None:
        pass

    def on_agent_finish(
            self, finish: AgentFinish, color: Optional[str] = None, **kwargs: Any
    ) -> None:
        pass
