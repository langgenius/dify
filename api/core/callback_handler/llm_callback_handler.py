import logging
import threading
import time
from typing import Any, Dict, List, Union

from flask import Flask, current_app
from langchain.callbacks.base import BaseCallbackHandler
from langchain.schema import LLMResult, BaseMessage
from pydantic import BaseModel

from core.callback_handler.entity.llm_message import LLMMessage
from core.conversation_message_task import ConversationMessageTask, ConversationTaskStoppedException, \
    ConversationTaskInterruptException
from core.model_providers.models.entity.message import to_prompt_messages, PromptMessage
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

        app_model_config = self.conversation_message_task.app_model_config
        sensitive_word_avoidance_dict = app_model_config.sensitive_word_avoidance_dict

        self.is_moderation_working = False
        self.direct_output_response = None
        self.moderation_rule = None
        self.moderation_chunk = ''
        self.moderation_buffer = ''
        self.moderation_thread = None
        if sensitive_word_avoidance_dict and sensitive_word_avoidance_dict.get("enabled"):
            self.moderation_rule = ModerationRule(
                type=sensitive_word_avoidance_dict.get("type"),
                config=sensitive_word_avoidance_dict.get("config")
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
                "text": message.content
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
        if not self.conversation_message_task.streaming:
            moderation_result = self.moderation_completion_async(response.generations[0][0].text, True)
            if not moderation_result:
                self.llm_message.completion = response.generations[0][0].text

            self.conversation_message_task.append_message_text(self.llm_message.completion)
        else:
            if len(self.llm_message.completion) < 300:
                self.moderation_completion_async(self.llm_message.completion, True)
            elif self.moderation_chunk:
                self.moderation_completion_async(self.moderation_chunk, True)

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

        while self.is_moderation_working:
            time.sleep(0.1)

        if self.direct_output_response:
            raise ConversationTaskInterruptException()

        self.conversation_message_task.save_message(self.llm_message)

    def on_llm_new_token(self, token: str, **kwargs: Any) -> None:
        if self.direct_output_response:
            raise ConversationTaskInterruptException()

        try:
            self.conversation_message_task.append_message_text(token)
        except ConversationTaskStoppedException as ex:
            self.on_llm_error(error=ex)
            raise ex

        self.moderation_completion_async(token)

        self.llm_message.completion += token

    def on_llm_error(
            self, error: Union[Exception, KeyboardInterrupt], **kwargs: Any
    ) -> None:
        """Do nothing."""
        self.is_moderation_working = False
        if isinstance(error, ConversationTaskStoppedException):
            if self.conversation_message_task.streaming:
                self.llm_message.completion_tokens = self.model_instance.get_num_tokens(
                    [PromptMessage(content=self.llm_message.completion)]
                )
                self.conversation_message_task.save_message(llm_message=self.llm_message, by_stopped=True)
        if isinstance(error, ConversationTaskInterruptException):
            self.llm_message.completion = self.direct_output_response
            self.llm_message.completion_tokens = self.model_instance.get_num_tokens(
                [PromptMessage(content=self.llm_message.completion)]
            )
            self.conversation_message_task.save_message(llm_message=self.llm_message)
        else:
            logging.debug("on_llm_error: %s", error)

    def moderation_completion(self, token: str, no_chunk: bool = False) -> bool:
        """
        Moderation for outputs.

        :param token: LLM output content
        :return: bool
        """
        if not self.moderation_rule:
            return False

        if not no_chunk:
            self.moderation_chunk += token
            self.moderation_buffer += token
            if len(self.moderation_chunk) < 300:
                return False
        else:
            self.moderation_buffer += token
            self.moderation_chunk = token

        self.moderation_chunk = ''

        try:
            moderation_factory = ModerationFactory(
                name=self.moderation_rule.type,
                tenant_id=self.conversation_message_task.tenant_id,
                config=self.moderation_rule.config
            )

            logging.info('Moderation params: %s', self.moderation_buffer)
            result: ModerationOutputsResult = moderation_factory.moderation_for_outputs(self.moderation_buffer)
            if not result.flagged:
                return False

            if result.action == ModerationAction.DIRECT_OUTPUT:
                self.llm_message.completion = result.preset_response
            else:
                self.llm_message.completion = result.text + self.moderation_chunk

            if self.conversation_message_task.streaming:
                # trigger replace event
                logging.info("Moderation %s replace event: %s", result.action.value, self.llm_message.completion)
                self.conversation_message_task.on_message_replace(self.llm_message.completion)

                if result.action == ModerationAction.DIRECT_OUTPUT:
                    self.llm_message.completion_tokens = self.model_instance.get_num_tokens(
                        [PromptMessage(content=self.llm_message.completion)]
                    )
                    self.conversation_message_task.save_message(llm_message=self.llm_message)
                    raise ConversationTaskInterruptException()
        except ConversationTaskInterruptException as e:
            raise e
        except Exception as e:
            logging.error("Moderation Output error: %s", e)
            return False

        return True

    def moderation_completion_async(self, token: str, no_chunk: bool = False) -> bool:
        """
        Moderation for outputs.

        :param token: LLM output content
        :return: bool
        """
        if not self.moderation_rule:
            return False

        if not no_chunk:
            self.moderation_chunk += token
            self.moderation_buffer += token
            if len(self.moderation_chunk) < 300:
                return False
        else:
            self.moderation_buffer += token
            self.moderation_chunk = token

        self.moderation_chunk = ''

        if not self.moderation_thread:
            self.moderation_thread = threading.Thread(target=self.moderation_worker, kwargs={
                'flask_app': current_app._get_current_object()
            })

            self.moderation_thread.start()

    def moderation_worker(self, flask_app: Flask):
        with flask_app.app_context():
            self.is_moderation_working = True
            current_length = 0
            while self.is_moderation_working:
                moderation_buffer = self.moderation_buffer
                buffer_length = len(moderation_buffer)
                if buffer_length - current_length < 300:
                    if buffer_length - current_length == 0:
                        self.is_moderation_working = False
                        break

                    time.sleep(0.1)
                    continue

                current_length = buffer_length

                try:
                    moderation_factory = ModerationFactory(
                        name=self.moderation_rule.type,
                        tenant_id=self.conversation_message_task.tenant_id,
                        config=self.moderation_rule.config
                    )

                    logging.info('Moderation params: %s', moderation_buffer)
                    result: ModerationOutputsResult = moderation_factory.moderation_for_outputs(moderation_buffer)
                    if not result.flagged:
                        continue

                    if result.action == ModerationAction.DIRECT_OUTPUT:
                        self.is_moderation_working = False
                        self.llm_message.completion = result.preset_response
                        self.direct_output_response = result.preset_response
                    else:
                        self.llm_message.completion = result.text + self.moderation_buffer[len(moderation_buffer):]

                    if self.conversation_message_task.streaming:
                        # trigger replace event
                        logging.info("Moderation %s replace event: %s", result.action.value, self.llm_message.completion)
                        self.conversation_message_task.on_message_replace(self.llm_message.completion)
                except Exception as e:
                    logging.error("Moderation Output error: %s", e)
