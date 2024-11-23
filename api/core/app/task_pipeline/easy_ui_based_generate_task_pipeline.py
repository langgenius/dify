import json
import logging
import time
from collections.abc import Generator
from typing import Optional, Union, cast

from constants.tts_auto_play_timeout import TTS_AUTO_PLAY_TIMEOUT, TTS_AUTO_PLAY_YIELD_CPU_TIME
from core.app.apps.advanced_chat.app_generator_tts_publisher import AppGeneratorTTSPublisher, AudioTrunk
from core.app.apps.base_app_queue_manager import AppQueueManager, PublishFrom
from core.app.entities.app_invoke_entities import (
    AgentChatAppGenerateEntity,
    ChatAppGenerateEntity,
    CompletionAppGenerateEntity,
)
from core.app.entities.queue_entities import (
    QueueAgentMessageEvent,
    QueueAgentThoughtEvent,
    QueueAnnotationReplyEvent,
    QueueErrorEvent,
    QueueLLMChunkEvent,
    QueueMessageEndEvent,
    QueueMessageFileEvent,
    QueueMessageReplaceEvent,
    QueuePingEvent,
    QueueRetrieverResourcesEvent,
    QueueStopEvent,
)
from core.app.entities.task_entities import (
    AgentMessageStreamResponse,
    AgentThoughtStreamResponse,
    ChatbotAppBlockingResponse,
    ChatbotAppStreamResponse,
    CompletionAppBlockingResponse,
    CompletionAppStreamResponse,
    EasyUITaskState,
    ErrorStreamResponse,
    MessageAudioEndStreamResponse,
    MessageAudioStreamResponse,
    MessageEndStreamResponse,
    StreamResponse,
)
from core.app.task_pipeline.based_generate_task_pipeline import BasedGenerateTaskPipeline
from core.app.task_pipeline.message_cycle_manage import MessageCycleManage
from core.model_manager import ModelInstance
from core.model_runtime.entities.llm_entities import LLMResult, LLMResultChunk, LLMResultChunkDelta, LLMUsage
from core.model_runtime.entities.message_entities import (
    AssistantPromptMessage,
)
from core.model_runtime.model_providers.__base.large_language_model import LargeLanguageModel
from core.model_runtime.utils.encoders import jsonable_encoder
from core.ops.entities.trace_entity import TraceTaskName
from core.ops.ops_trace_manager import TraceQueueManager, TraceTask
from core.prompt.utils.prompt_message_util import PromptMessageUtil
from core.prompt.utils.prompt_template_parser import PromptTemplateParser
from events.message_event import message_was_created
from extensions.ext_database import db
from models.account import Account
from models.model import AppMode, Conversation, EndUser, Message, MessageAgentThought

logger = logging.getLogger(__name__)


class EasyUIBasedGenerateTaskPipeline(BasedGenerateTaskPipeline, MessageCycleManage):
    """
    EasyUIBasedGenerateTaskPipeline is a class that generate stream output and state management for Application.
    """

    _task_state: EasyUITaskState
    _application_generate_entity: Union[ChatAppGenerateEntity, CompletionAppGenerateEntity, AgentChatAppGenerateEntity]

    def __init__(
        self,
        application_generate_entity: Union[
            ChatAppGenerateEntity, CompletionAppGenerateEntity, AgentChatAppGenerateEntity
        ],
        queue_manager: AppQueueManager,
        conversation: Conversation,
        message: Message,
        user: Union[Account, EndUser],
        stream: bool,
    ) -> None:
        """
        Initialize GenerateTaskPipeline.
        :param application_generate_entity: application generate entity
        :param queue_manager: queue manager
        :param conversation: conversation
        :param message: message
        :param user: user
        :param stream: stream
        """
        super().__init__(application_generate_entity, queue_manager, user, stream)
        self._model_config = application_generate_entity.model_conf
        self._app_config = application_generate_entity.app_config
        self._conversation = conversation
        self._message = message

        self._task_state = EasyUITaskState(
            llm_result=LLMResult(
                model=self._model_config.model,
                prompt_messages=[],
                message=AssistantPromptMessage(content=""),
                usage=LLMUsage.empty_usage(),
            )
        )

        self._conversation_name_generate_thread = None

    def process(
        self,
    ) -> Union[
        ChatbotAppBlockingResponse,
        CompletionAppBlockingResponse,
        Generator[Union[ChatbotAppStreamResponse, CompletionAppStreamResponse], None, None],
    ]:
        """
        Process generate task pipeline.
        :return:
        """
        db.session.refresh(self._conversation)
        db.session.refresh(self._message)
        db.session.close()

        if self._application_generate_entity.app_config.app_mode != AppMode.COMPLETION:
            # start generate conversation name thread
            self._conversation_name_generate_thread = self._generate_conversation_name(
                self._conversation, self._application_generate_entity.query
            )

        generator = self._wrapper_process_stream_response(trace_manager=self._application_generate_entity.trace_manager)
        if self._stream:
            return self._to_stream_response(generator)
        else:
            return self._to_blocking_response(generator)

    def _to_blocking_response(
        self, generator: Generator[StreamResponse, None, None]
    ) -> Union[ChatbotAppBlockingResponse, CompletionAppBlockingResponse]:
        """
        Process blocking response.
        :return:
        """
        for stream_response in generator:
            if isinstance(stream_response, ErrorStreamResponse):
                raise stream_response.err
            elif isinstance(stream_response, MessageEndStreamResponse):
                extras = {"usage": jsonable_encoder(self._task_state.llm_result.usage)}
                if self._task_state.metadata:
                    extras["metadata"] = self._task_state.metadata

                if self._conversation.mode == AppMode.COMPLETION.value:
                    response = CompletionAppBlockingResponse(
                        task_id=self._application_generate_entity.task_id,
                        data=CompletionAppBlockingResponse.Data(
                            id=self._message.id,
                            mode=self._conversation.mode,
                            message_id=self._message.id,
                            answer=self._task_state.llm_result.message.content,
                            created_at=int(self._message.created_at.timestamp()),
                            **extras,
                        ),
                    )
                else:
                    response = ChatbotAppBlockingResponse(
                        task_id=self._application_generate_entity.task_id,
                        data=ChatbotAppBlockingResponse.Data(
                            id=self._message.id,
                            mode=self._conversation.mode,
                            conversation_id=self._conversation.id,
                            message_id=self._message.id,
                            answer=self._task_state.llm_result.message.content,
                            created_at=int(self._message.created_at.timestamp()),
                            **extras,
                        ),
                    )

                return response
            else:
                continue

        raise Exception("Queue listening stopped unexpectedly.")

    def _to_stream_response(
        self, generator: Generator[StreamResponse, None, None]
    ) -> Generator[Union[ChatbotAppStreamResponse, CompletionAppStreamResponse], None, None]:
        """
        To stream response.
        :return:
        """
        for stream_response in generator:
            if isinstance(self._application_generate_entity, CompletionAppGenerateEntity):
                yield CompletionAppStreamResponse(
                    message_id=self._message.id,
                    created_at=int(self._message.created_at.timestamp()),
                    stream_response=stream_response,
                )
            else:
                yield ChatbotAppStreamResponse(
                    conversation_id=self._conversation.id,
                    message_id=self._message.id,
                    created_at=int(self._message.created_at.timestamp()),
                    stream_response=stream_response,
                )

    def _listen_audio_msg(self, publisher, task_id: str):
        if publisher is None:
            return None
        audio_msg: AudioTrunk = publisher.check_and_get_audio()
        if audio_msg and audio_msg.status != "finish":
            # audio_str = audio_msg.audio.decode('utf-8', errors='ignore')
            return MessageAudioStreamResponse(audio=audio_msg.audio, task_id=task_id)
        return None

    def _wrapper_process_stream_response(
        self, trace_manager: Optional[TraceQueueManager] = None
    ) -> Generator[StreamResponse, None, None]:
        tenant_id = self._application_generate_entity.app_config.tenant_id
        task_id = self._application_generate_entity.task_id
        publisher = None
        text_to_speech_dict = self._app_config.app_model_config_dict.get("text_to_speech")
        if (
            text_to_speech_dict
            and text_to_speech_dict.get("autoPlay") == "enabled"
            and text_to_speech_dict.get("enabled")
        ):
            publisher = AppGeneratorTTSPublisher(tenant_id, text_to_speech_dict.get("voice", None))
        for response in self._process_stream_response(publisher=publisher, trace_manager=trace_manager):
            while True:
                audio_response = self._listen_audio_msg(publisher, task_id)
                if audio_response:
                    yield audio_response
                else:
                    break
            yield response

        start_listener_time = time.time()
        # timeout
        while (time.time() - start_listener_time) < TTS_AUTO_PLAY_TIMEOUT:
            if publisher is None:
                break
            audio = publisher.check_and_get_audio()
            if audio is None:
                # release cpu
                # sleep 20 ms ( 40ms => 1280 byte audio file,20ms => 640 byte audio file)
                time.sleep(TTS_AUTO_PLAY_YIELD_CPU_TIME)
                continue
            if audio.status == "finish":
                break
            else:
                start_listener_time = time.time()
                yield MessageAudioStreamResponse(audio=audio.audio, task_id=task_id)
        if publisher:
            yield MessageAudioEndStreamResponse(audio="", task_id=task_id)

    def _process_stream_response(
        self, publisher: AppGeneratorTTSPublisher, trace_manager: Optional[TraceQueueManager] = None
    ) -> Generator[StreamResponse, None, None]:
        """
        Process stream response.
        :return:
        """
        for message in self._queue_manager.listen():
            if publisher:
                publisher.publish(message)
            event = message.event

            if isinstance(event, QueueErrorEvent):
                err = self._handle_error(event, self._message)
                yield self._error_to_stream_response(err)
                break
            elif isinstance(event, QueueStopEvent | QueueMessageEndEvent):
                if isinstance(event, QueueMessageEndEvent):
                    self._task_state.llm_result = event.llm_result
                else:
                    self._handle_stop(event)

                # handle output moderation
                output_moderation_answer = self._handle_output_moderation_when_task_finished(
                    self._task_state.llm_result.message.content
                )
                if output_moderation_answer:
                    self._task_state.llm_result.message.content = output_moderation_answer
                    yield self._message_replace_to_stream_response(answer=output_moderation_answer)

                # Save message
                self._save_message(trace_manager)

                yield self._message_end_to_stream_response()
            elif isinstance(event, QueueRetrieverResourcesEvent):
                self._handle_retriever_resources(event)
            elif isinstance(event, QueueAnnotationReplyEvent):
                annotation = self._handle_annotation_reply(event)
                if annotation:
                    self._task_state.llm_result.message.content = annotation.content
            elif isinstance(event, QueueAgentThoughtEvent):
                yield self._agent_thought_to_stream_response(event)
            elif isinstance(event, QueueMessageFileEvent):
                response = self._message_file_to_stream_response(event)
                if response:
                    yield response
            elif isinstance(event, QueueLLMChunkEvent | QueueAgentMessageEvent):
                chunk = event.chunk
                delta_text = chunk.delta.message.content
                if delta_text is None:
                    continue

                if not self._task_state.llm_result.prompt_messages:
                    self._task_state.llm_result.prompt_messages = chunk.prompt_messages

                # handle output moderation chunk
                should_direct_answer = self._handle_output_moderation_chunk(delta_text)
                if should_direct_answer:
                    continue

                self._task_state.llm_result.message.content += delta_text

                if isinstance(event, QueueLLMChunkEvent):
                    yield self._message_to_stream_response(delta_text, self._message.id)
                else:
                    yield self._agent_message_to_stream_response(delta_text, self._message.id)
            elif isinstance(event, QueueMessageReplaceEvent):
                yield self._message_replace_to_stream_response(answer=event.text)
            elif isinstance(event, QueuePingEvent):
                yield self._ping_stream_response()
            else:
                continue
        if publisher:
            publisher.publish(None)
        if self._conversation_name_generate_thread:
            self._conversation_name_generate_thread.join()

    def _save_message(self, trace_manager: Optional[TraceQueueManager] = None) -> None:
        """
        Save message.
        :return:
        """
        llm_result = self._task_state.llm_result
        usage = llm_result.usage

        self._message = db.session.query(Message).filter(Message.id == self._message.id).first()
        self._conversation = db.session.query(Conversation).filter(Conversation.id == self._conversation.id).first()

        self._message.message = PromptMessageUtil.prompt_messages_to_prompt_for_saving(
            self._model_config.mode, self._task_state.llm_result.prompt_messages
        )
        self._message.message_tokens = usage.prompt_tokens
        self._message.message_unit_price = usage.prompt_unit_price
        self._message.message_price_unit = usage.prompt_price_unit
        self._message.answer = (
            PromptTemplateParser.remove_template_variables(llm_result.message.content.strip())
            if llm_result.message.content
            else ""
        )
        self._message.answer_tokens = usage.completion_tokens
        self._message.answer_unit_price = usage.completion_unit_price
        self._message.answer_price_unit = usage.completion_price_unit
        self._message.provider_response_latency = time.perf_counter() - self._start_at
        self._message.total_price = usage.total_price
        self._message.currency = usage.currency
        self._message.message_metadata = (
            json.dumps(jsonable_encoder(self._task_state.metadata)) if self._task_state.metadata else None
        )

        db.session.commit()

        if trace_manager:
            trace_manager.add_trace_task(
                TraceTask(
                    TraceTaskName.MESSAGE_TRACE, conversation_id=self._conversation.id, message_id=self._message.id
                )
            )

        message_was_created.send(
            self._message,
            application_generate_entity=self._application_generate_entity,
            conversation=self._conversation,
            is_first_message=self._application_generate_entity.app_config.app_mode in {AppMode.AGENT_CHAT, AppMode.CHAT}
            and self._application_generate_entity.conversation_id is None,
            extras=self._application_generate_entity.extras,
        )

    def _handle_stop(self, event: QueueStopEvent) -> None:
        """
        Handle stop.
        :return:
        """
        model_config = self._model_config
        model = model_config.model

        model_instance = ModelInstance(
            provider_model_bundle=model_config.provider_model_bundle, model=model_config.model
        )

        # calculate num tokens
        prompt_tokens = 0
        if event.stopped_by != QueueStopEvent.StopBy.ANNOTATION_REPLY:
            prompt_tokens = model_instance.get_llm_num_tokens(self._task_state.llm_result.prompt_messages)

        completion_tokens = 0
        if event.stopped_by == QueueStopEvent.StopBy.USER_MANUAL:
            completion_tokens = model_instance.get_llm_num_tokens([self._task_state.llm_result.message])

        credentials = model_config.credentials

        # transform usage
        model_type_instance = model_config.provider_model_bundle.model_type_instance
        model_type_instance = cast(LargeLanguageModel, model_type_instance)
        self._task_state.llm_result.usage = model_type_instance._calc_response_usage(
            model, credentials, prompt_tokens, completion_tokens
        )

    def _message_end_to_stream_response(self) -> MessageEndStreamResponse:
        """
        Message end to stream response.
        :return:
        """
        self._task_state.metadata["usage"] = jsonable_encoder(self._task_state.llm_result.usage)

        extras = {}
        if self._task_state.metadata:
            extras["metadata"] = self._task_state.metadata

        return MessageEndStreamResponse(
            task_id=self._application_generate_entity.task_id, id=self._message.id, **extras
        )

    def _agent_message_to_stream_response(self, answer: str, message_id: str) -> AgentMessageStreamResponse:
        """
        Agent message to stream response.
        :param answer: answer
        :param message_id: message id
        :return:
        """
        return AgentMessageStreamResponse(
            task_id=self._application_generate_entity.task_id, id=message_id, answer=answer
        )

    def _agent_thought_to_stream_response(self, event: QueueAgentThoughtEvent) -> Optional[AgentThoughtStreamResponse]:
        """
        Agent thought to stream response.
        :param event: agent thought event
        :return:
        """
        agent_thought: MessageAgentThought = (
            db.session.query(MessageAgentThought).filter(MessageAgentThought.id == event.agent_thought_id).first()
        )
        db.session.refresh(agent_thought)
        db.session.close()

        if agent_thought:
            return AgentThoughtStreamResponse(
                task_id=self._application_generate_entity.task_id,
                id=agent_thought.id,
                position=agent_thought.position,
                thought=agent_thought.thought,
                observation=agent_thought.observation,
                tool=agent_thought.tool,
                tool_labels=agent_thought.tool_labels,
                tool_input=agent_thought.tool_input,
                message_files=agent_thought.files,
            )

        return None

    def _handle_output_moderation_chunk(self, text: str) -> bool:
        """
        Handle output moderation chunk.
        :param text: text
        :return: True if output moderation should direct output, otherwise False
        """
        if self._output_moderation_handler:
            if self._output_moderation_handler.should_direct_output():
                # stop subscribe new token when output moderation should direct output
                self._task_state.llm_result.message.content = self._output_moderation_handler.get_final_output()
                self._queue_manager.publish(
                    QueueLLMChunkEvent(
                        chunk=LLMResultChunk(
                            model=self._task_state.llm_result.model,
                            prompt_messages=self._task_state.llm_result.prompt_messages,
                            delta=LLMResultChunkDelta(
                                index=0,
                                message=AssistantPromptMessage(content=self._task_state.llm_result.message.content),
                            ),
                        )
                    ),
                    PublishFrom.TASK_PIPELINE,
                )

                self._queue_manager.publish(
                    QueueStopEvent(stopped_by=QueueStopEvent.StopBy.OUTPUT_MODERATION), PublishFrom.TASK_PIPELINE
                )
                return True
            else:
                self._output_moderation_handler.append_new_token(text)

        return False
