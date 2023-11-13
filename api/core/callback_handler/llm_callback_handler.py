import logging
import threading
import time
from typing import Any, Dict, List, Union, Optional

from flask import Flask, current_app
from langchain.callbacks.base import BaseCallbackHandler
from langchain.schema import LLMResult, BaseMessage
from pydantic import BaseModel

from core.callback_handler.entity.llm_message import LLMMessage
from core.conversation_message_task import ConversationMessageTask, ConversationTaskStoppedException, \
    ConversationTaskInterruptException
from core.model_providers.models.entity.message import to_prompt_messages, PromptMessage, LCHumanMessageWithFiles, \
    ImagePromptMessageFile
from core.model_providers.models.llm.base import BaseLLM
from core.moderation.base import ModerationOutputsResult, ModerationAction
from core.moderation.factory import ModerationFactory


class ModerationRule(BaseModel):
    type: str
    config: Dict[str, Any]


class LLMCallbackHandler(BaseCallbackHandler):
    raise_error: bool = True

    def __init__(self, model_instance: BaseLLM,
                 conversation_message_task: ConversationMessageTask):
        self.model_instance = model_instance
        self.llm_message = LLMMessage()
        self.start_at = None
        self.conversation_message_task = conversation_message_task

        self.output_moderation_handler = None
        self.init_output_moderation()

    def init_output_moderation(self):
        app_model_config = self.conversation_message_task.app_model_config
        sensitive_word_avoidance_dict = app_model_config.sensitive_word_avoidance_dict

        if sensitive_word_avoidance_dict and sensitive_word_avoidance_dict.get("enabled"):
            self.output_moderation_handler = OutputModerationHandler(
                tenant_id=self.conversation_message_task.tenant_id,
                app_id=self.conversation_message_task.app.id,
                rule=ModerationRule(
                    type=sensitive_word_avoidance_dict.get("type"),
                    config=sensitive_word_avoidance_dict.get("config")
                ),
                on_message_replace_func=self.conversation_message_task.on_message_replace
            )

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
                "text": message.content,
                "files": [{
                    "type": file.type.value,
                    "data": file.data[:10] + '...[TRUNCATED]...' + file.data[-10:],
                    "detail": file.detail.value if isinstance(file, ImagePromptMessageFile) else None,
                } for file in (message.files if isinstance(message, LCHumanMessageWithFiles) else [])]
            })

        self.llm_message.prompt = real_prompts
        self.llm_message.prompt_tokens = self.model_instance.get_num_tokens(to_prompt_messages(messages[0]))

    def on_llm_start(
        self, serialized: Dict[str, Any], prompts: List[str], **kwargs: Any
    ) -> None:
        self.llm_message.prompt = [{
            "role": 'user',
            "text": prompts[0]
        }]

        self.llm_message.prompt_tokens = self.model_instance.get_num_tokens([PromptMessage(content=prompts[0])])

    def on_llm_end(self, response: LLMResult, **kwargs: Any) -> None:
        if self.output_moderation_handler:
            self.output_moderation_handler.stop_thread()

            self.llm_message.completion = self.output_moderation_handler.moderation_completion(
                completion=response.generations[0][0].text,
                public_event=True if self.conversation_message_task.streaming else False
            )
        else:
            self.llm_message.completion = response.generations[0][0].text

        if not self.conversation_message_task.streaming:
            self.conversation_message_task.append_message_text(self.llm_message.completion)

        if response.llm_output and 'token_usage' in response.llm_output:
            if 'prompt_tokens' in response.llm_output['token_usage']:
                self.llm_message.prompt_tokens = response.llm_output['token_usage']['prompt_tokens']

            if 'completion_tokens' in response.llm_output['token_usage']:
                self.llm_message.completion_tokens = response.llm_output['token_usage']['completion_tokens']
            else:
                self.llm_message.completion_tokens = self.model_instance.get_num_tokens(
                    [PromptMessage(content=self.llm_message.completion)])
        else:
            self.llm_message.completion_tokens = self.model_instance.get_num_tokens(
                [PromptMessage(content=self.llm_message.completion)])

        self.conversation_message_task.save_message(self.llm_message)

    def on_llm_new_token(self, token: str, **kwargs: Any) -> None:
        if self.output_moderation_handler and self.output_moderation_handler.should_direct_output():
            # stop subscribe new token when output moderation should direct output
            ex = ConversationTaskInterruptException()
            self.on_llm_error(error=ex)
            raise ex

        try:
            self.conversation_message_task.append_message_text(token)
            self.llm_message.completion += token

            if self.output_moderation_handler:
                self.output_moderation_handler.append_new_token(token)
        except ConversationTaskStoppedException as ex:
            self.on_llm_error(error=ex)
            raise ex

    def on_llm_error(
            self, error: Union[Exception, KeyboardInterrupt], **kwargs: Any
    ) -> None:
        """Do nothing."""
        if self.output_moderation_handler:
            self.output_moderation_handler.stop_thread()

        if isinstance(error, ConversationTaskStoppedException):
            if self.conversation_message_task.streaming:
                self.llm_message.completion_tokens = self.model_instance.get_num_tokens(
                    [PromptMessage(content=self.llm_message.completion)]
                )
                self.conversation_message_task.save_message(llm_message=self.llm_message, by_stopped=True)
        if isinstance(error, ConversationTaskInterruptException):
            self.llm_message.completion = self.output_moderation_handler.get_final_output()
            self.llm_message.completion_tokens = self.model_instance.get_num_tokens(
                [PromptMessage(content=self.llm_message.completion)]
            )
            self.conversation_message_task.save_message(llm_message=self.llm_message)
        else:
            logging.debug("on_llm_error: %s", error)


class OutputModerationHandler(BaseModel):
    DEFAULT_BUFFER_SIZE: int = 300

    tenant_id: str
    app_id: str

    rule: ModerationRule
    on_message_replace_func: Any

    thread: Optional[threading.Thread] = None
    thread_running: bool = True
    buffer: str = ''
    is_final_chunk: bool = False
    final_output: Optional[str] = None

    class Config:
        arbitrary_types_allowed = True

    def should_direct_output(self):
        return self.final_output is not None

    def get_final_output(self):
        return self.final_output

    def append_new_token(self, token: str):
        self.buffer += token

        if not self.thread:
            self.thread = self.start_thread()

    def moderation_completion(self, completion: str, public_event: bool = False) -> str:
        self.buffer = completion
        self.is_final_chunk = True

        result = self.moderation(
            tenant_id=self.tenant_id,
            app_id=self.app_id,
            moderation_buffer=completion
        )

        if not result or not result.flagged:
            return completion

        if result.action == ModerationAction.DIRECT_OUTPUT:
            final_output = result.preset_response
        else:
            final_output = result.text

        if public_event:
            self.on_message_replace_func(final_output)

        return final_output

    def start_thread(self) -> threading.Thread:
        buffer_size = int(current_app.config.get('MODERATION_BUFFER_SIZE', self.DEFAULT_BUFFER_SIZE))
        thread = threading.Thread(target=self.worker, kwargs={
            'flask_app': current_app._get_current_object(),
            'buffer_size': buffer_size if buffer_size > 0 else self.DEFAULT_BUFFER_SIZE
        })

        thread.start()

        return thread

    def stop_thread(self):
        if self.thread and self.thread.is_alive():
            self.thread_running = False

    def worker(self, flask_app: Flask, buffer_size: int):
        with flask_app.app_context():
            current_length = 0
            while self.thread_running:
                moderation_buffer = self.buffer
                buffer_length = len(moderation_buffer)
                if not self.is_final_chunk:
                    chunk_length = buffer_length - current_length
                    if 0 <= chunk_length < buffer_size:
                        time.sleep(1)
                        continue

                current_length = buffer_length

                result = self.moderation(
                    tenant_id=self.tenant_id,
                    app_id=self.app_id,
                    moderation_buffer=moderation_buffer
                )

                if not result or not result.flagged:
                    continue

                if result.action == ModerationAction.DIRECT_OUTPUT:
                    final_output = result.preset_response
                    self.final_output = final_output
                else:
                    final_output = result.text + self.buffer[len(moderation_buffer):]

                # trigger replace event
                if self.thread_running:
                    self.on_message_replace_func(final_output)

                if result.action == ModerationAction.DIRECT_OUTPUT:
                    break

    def moderation(self, tenant_id: str, app_id: str, moderation_buffer: str) -> Optional[ModerationOutputsResult]:
        try:
            moderation_factory = ModerationFactory(
                name=self.rule.type,
                app_id=app_id,
                tenant_id=tenant_id,
                config=self.rule.config
            )

            result: ModerationOutputsResult = moderation_factory.moderation_for_outputs(moderation_buffer)
            return result
        except Exception as e:
            logging.error("Moderation Output error: %s", e)

        return None
