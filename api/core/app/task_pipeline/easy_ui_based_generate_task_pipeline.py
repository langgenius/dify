import json
import logging
import time
from collections.abc import Generator, Mapping, Sequence
from threading import Thread
from typing import Any, Literal, cast

from sqlalchemy import select
from sqlalchemy.orm import Session

from core.app.apps.base_app_queue_manager import AppQueueManager, PublishFrom
from core.app.entities.app_invoke_entities import (
    AgentChatAppGenerateEntity,
    ChatAppGenerateEntity,
    CompletionAppGenerateEntity,
    get_credit_usage_app_type,
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
    MessageContentStreamResponse,
    MessageEndStreamResponse,
    MessageStreamResponse,
    StreamEvent,
    StreamResponse,
)
from core.app.task_pipeline.based_generate_task_pipeline import BasedGenerateTaskPipeline
from core.app.task_pipeline.message_cycle_manager import MessageCycleManager
from core.app.task_pipeline.message_file_utils import prepare_file_dict
from core.base.tts import AppGeneratorTTSPublisher
from core.db.session_factory import session_factory
from core.model_manager import ModelInstance
from core.ops.entities.trace_entity import TraceTaskName
from core.ops.ops_trace_manager import TraceQueueManager, TraceTask
from core.prompt.utils.prompt_message_util import PromptMessageUtil
from core.prompt.utils.prompt_template_parser import PromptTemplateParser
from events.message_event import message_was_created
from graphon.file import FileTransferMethod
from graphon.model_runtime.entities.llm_entities import LLMResult, LLMResultChunk, LLMResultChunkDelta, LLMUsage
from graphon.model_runtime.entities.message_entities import (
    AssistantPromptMessage,
    TextPromptMessageContent,
)
from graphon.model_runtime.model_providers.base.large_language_model import LargeLanguageModel
from libs.datetime_utils import naive_utc_now
from libs.generative_ui import (
    OpenUIContentBlock,
    OpenUIStreamParser,
    encode_openui_update,
    extract_openui_prose,
    generative_ui_enabled,
)
from models.model import AppMode, Conversation, Message, MessageAgentThought, MessageFile, UploadFile

logger = logging.getLogger(__name__)

type EasyUIAppGenerateEntity = ChatAppGenerateEntity | CompletionAppGenerateEntity | AgentChatAppGenerateEntity


class EasyUIBasedGenerateTaskPipeline(BasedGenerateTaskPipeline[EasyUIAppGenerateEntity]):
    """
    EasyUIBasedGenerateTaskPipeline is a class that generate stream output and state management for Application.
    """

    _task_state: EasyUITaskState
    _precomputed_event_type: StreamEvent | None = None

    def __init__(
        self,
        application_generate_entity: EasyUIAppGenerateEntity,
        queue_manager: AppQueueManager,
        conversation: Conversation,
        message: Message,
        stream: bool,
    ):
        super().__init__(
            application_generate_entity=application_generate_entity,
            queue_manager=queue_manager,
            stream=stream,
        )
        self._model_config = application_generate_entity.model_conf
        self._app_config = application_generate_entity.app_config

        self._conversation_id = conversation.id
        self._conversation_mode = conversation.mode

        self._message_id = message.id
        self._message_created_at = int(message.created_at.timestamp())
        self._generative_ui_enabled = self._app_config.app_mode == AppMode.AGENT and generative_ui_enabled(
            self._app_config.app_model_config_dict.get("generative_ui")
        )
        self._openui_parser = OpenUIStreamParser(message.id)
        self._openui_agent_parser = OpenUIStreamParser(message.id)
        self._openui_final_started = False
        self._openui_live_prose = ""
        self._openui_response_is_partial = False
        self._openui_sequences: dict[str, int] = {}
        self._generative_ui_suppressed = False

        self._task_state = EasyUITaskState(
            llm_result=LLMResult(
                model=self._model_config.model,
                prompt_messages=[],
                message=AssistantPromptMessage(content=""),
                usage=LLMUsage.empty_usage(),
            )
        )

        self._message_cycle_manager = MessageCycleManager(
            application_generate_entity=application_generate_entity,
            task_state=self._task_state,
        )

        self._conversation_name_generate_thread: Thread | None = None

    def process(
        self,
    ) -> (
        ChatbotAppBlockingResponse
        | CompletionAppBlockingResponse
        | Generator[ChatbotAppStreamResponse | CompletionAppStreamResponse]
    ):
        if self._application_generate_entity.app_config.app_mode != AppMode.COMPLETION:
            # start generate conversation name thread
            self._conversation_name_generate_thread = self._message_cycle_manager.generate_conversation_name(
                conversation_id=self._conversation_id,
                query=self._application_generate_entity.query,
                message_id=self._message_id,
            )

        generator = self._wrapper_process_stream_response(trace_manager=self._application_generate_entity.trace_manager)
        if self.stream:
            return self._to_stream_response(generator)
        else:
            return self._to_blocking_response(generator)

    def _to_blocking_response(
        self, generator: Generator[StreamResponse]
    ) -> ChatbotAppBlockingResponse | CompletionAppBlockingResponse:
        """
        Process blocking response.
        :return:
        """
        for stream_response in generator:
            match stream_response:
                case ErrorStreamResponse():
                    raise stream_response.err
                case MessageEndStreamResponse():
                    extras = {"usage": self._task_state.llm_result.usage.model_dump()}
                    if self._task_state.metadata:
                        extras["metadata"] = self._task_state.metadata.model_dump()
                        if self._openui_response_is_partial:
                            extras["metadata"]["agent_response_is_partial"] = True
                    response: ChatbotAppBlockingResponse | CompletionAppBlockingResponse
                    if self._conversation_mode == AppMode.COMPLETION:
                        response = CompletionAppBlockingResponse(
                            task_id=self._application_generate_entity.task_id,
                            data=CompletionAppBlockingResponse.Data(
                                id=self._message_id,
                                mode=self._conversation_mode,
                                message_id=self._message_id,
                                answer=self._task_state.llm_result.message.get_text_content(),
                                created_at=self._message_created_at,
                                **extras,
                            ),
                        )
                    else:
                        response = ChatbotAppBlockingResponse(
                            task_id=self._application_generate_entity.task_id,
                            data=ChatbotAppBlockingResponse.Data(
                                id=self._message_id,
                                mode=self._conversation_mode,
                                conversation_id=self._conversation_id,
                                message_id=self._message_id,
                                answer=self._task_state.llm_result.message.get_text_content(),
                                created_at=self._message_created_at,
                                **extras,
                            ),
                        )

                    return response
                case _:
                    continue

        raise RuntimeError("queue listening stopped unexpectedly.")

    def _to_stream_response(
        self, generator: Generator[StreamResponse]
    ) -> Generator[ChatbotAppStreamResponse | CompletionAppStreamResponse]:
        """
        To stream response.
        :return:
        """
        for stream_response in generator:
            if isinstance(self._application_generate_entity, CompletionAppGenerateEntity):
                yield CompletionAppStreamResponse(
                    message_id=self._message_id,
                    created_at=self._message_created_at,
                    stream_response=stream_response,
                )
            else:
                yield ChatbotAppStreamResponse(
                    conversation_id=self._conversation_id,
                    message_id=self._message_id,
                    created_at=self._message_created_at,
                    stream_response=stream_response,
                )

    def _listen_audio_msg(self, publisher: AppGeneratorTTSPublisher | None, task_id: str):
        if publisher is None:
            return None
        audio_msg = publisher.check_and_get_audio()
        if audio_msg is None:
            return None
        if audio_msg.status == "responding":
            return MessageAudioStreamResponse(audio=audio_msg.audio, audio_type=audio_msg.audio_type, task_id=task_id)
        if audio_msg.status in {"finish", "error"}:
            return None
        raise RuntimeError(f"TTS publisher returned an unknown status: {audio_msg.status}")

    def _wrapper_process_stream_response(
        self, trace_manager: TraceQueueManager | None = None
    ) -> Generator[StreamResponse]:
        tenant_id = self._application_generate_entity.app_config.tenant_id
        task_id = self._application_generate_entity.task_id
        publisher = None
        text_to_speech_dict = cast(dict[str, Any], self._app_config.app_model_config_dict.get("text_to_speech"))
        if (
            self.stream
            and text_to_speech_dict
            and text_to_speech_dict.get("autoPlay") == "enabled"
            and text_to_speech_dict.get("enabled")
        ):
            publisher = AppGeneratorTTSPublisher(
                tenant_id,
                text_to_speech_dict.get("voice", ""),
                text_to_speech_dict.get("language", None),
                get_credit_usage_app_type(self._app_config.app_mode),
            )
        try:
            for response in self._process_stream_response(publisher=publisher, trace_manager=trace_manager):
                while audio_response := self._listen_audio_msg(publisher, task_id):
                    yield audio_response
                if publisher and isinstance(response, ErrorStreamResponse):
                    publisher.cancel()
                    yield MessageAudioEndStreamResponse(audio="", task_id=task_id)
                    yield response
                    return
                yield response

            if publisher is None:
                return

            publisher.publish(None)
            while True:
                audio = publisher.check_and_get_audio(block=True)
                assert audio is not None
                if audio.status == "responding":
                    yield MessageAudioStreamResponse(audio=audio.audio, audio_type=audio.audio_type, task_id=task_id)
                    continue
                if audio.status not in {"finish", "error"}:
                    raise RuntimeError(f"TTS publisher returned an unknown status: {audio.status}")

                yield MessageAudioEndStreamResponse(audio="", task_id=task_id)
                if audio.status == "error":
                    if audio.error is None:
                        raise RuntimeError("TTS publisher returned an error terminal without an exception")
                    yield ErrorStreamResponse(err=audio.error, task_id=task_id)
                return
        finally:
            if publisher:
                publisher.cancel()

    def _process_stream_response(
        self, publisher: AppGeneratorTTSPublisher | None, trace_manager: TraceQueueManager | None = None
    ) -> Generator[StreamResponse]:
        """
        Process stream response.
        :return:
        """
        for message in self.queue_manager.listen():
            event = message.event
            if publisher and (
                not self._generative_ui_enabled or not isinstance(event, QueueLLMChunkEvent | QueueAgentMessageEvent)
            ):
                publisher.publish(message)

            match event:
                case QueueErrorEvent():
                    if self._generative_ui_enabled:
                        yield from self._finish_generative_ui("error")
                    with session_factory.create_session() as session:
                        if self._generative_ui_enabled:
                            self._save_message(session=session, trace_manager=trace_manager)
                        err = self.handle_error(event=event, session=session, message_id=self._message_id)
                        session.commit()

                    if trace_manager:
                        trace_manager.add_trace_task(
                            TraceTask(
                                TraceTaskName.MESSAGE_TRACE,
                                conversation_id=self._conversation_id,
                                message_id=self._message_id,
                                trace_session_id=self._application_generate_entity.extras.get("trace_session_id"),
                            )
                        )

                    yield self.error_to_stream_response(err)
                    break
                case QueueStopEvent() | QueueMessageEndEvent():
                    if isinstance(event, QueueMessageEndEvent):
                        if event.llm_result:
                            if self._generative_ui_enabled and not self._openui_final_started:
                                yield from self._process_generative_ui_final_text(
                                    event.llm_result.message.get_text_content()
                                )
                            text_content = self._task_state.llm_result.message.get_text_content()
                            self._task_state.llm_result = event.llm_result
                            if self._generative_ui_enabled:
                                self._task_state.llm_result.message.content = text_content
                    if self._generative_ui_enabled:
                        yield from self._finish_generative_ui(
                            "cancelled" if isinstance(event, QueueStopEvent) else "completed"
                        )
                    if isinstance(event, QueueStopEvent):
                        self._handle_stop(event)

                    # handle output moderation
                    output_moderation_answer = self.handle_output_moderation_when_task_finished(
                        self._task_state.llm_result.message.get_text_content(),
                        extra_texts=[block.source for block in self._task_state.metadata.content_blocks],
                    )
                    if output_moderation_answer is not None:
                        self._task_state.metadata.content_blocks.clear()
                        if self._generative_ui_enabled:
                            self._generative_ui_suppressed = True
                            self._openui_response_is_partial = False
                            output_moderation_answer = extract_openui_prose(output_moderation_answer)
                        self._task_state.llm_result.message.content = output_moderation_answer
                        yield self._message_cycle_manager.message_replace_to_stream_response(
                            answer=output_moderation_answer,
                            reason=QueueMessageReplaceEvent.MessageReplaceReason.OUTPUT_MODERATION,
                        )

                    stopped_agent_message: Message | None = None
                    with session_factory.create_session() as session:
                        # A stopped Agent run may persist provider-reported usage after
                        # cancellation completes. Do not replace it with local token estimates.
                        if isinstance(event, QueueStopEvent):
                            saved_message = self._save_message(
                                session=session,
                                trace_manager=trace_manager,
                                preserve_existing_usage=True,
                            )
                            if self._app_config.app_mode == AppMode.AGENT:
                                stopped_agent_message = saved_message
                        else:
                            self._save_message(session=session, trace_manager=trace_manager)
                        session.commit()
                    if stopped_agent_message is not None:
                        # Provider/billing subscribers may perform external I/O.
                        # Release the stop-save row lock before notifying them.
                        message_was_created.send(
                            stopped_agent_message,
                            application_generate_entity=self._application_generate_entity,
                        )
                    message_end_resp = self._message_end_to_stream_response()
                    yield message_end_resp
                case QueueRetrieverResourcesEvent():
                    self._message_cycle_manager.handle_retriever_resources(event)
                case QueueAnnotationReplyEvent():
                    annotation_content = None
                    with session_factory.create_session() as session:
                        annotation = self._message_cycle_manager.handle_annotation_reply(event, session)
                        if annotation:
                            annotation_content = annotation.content
                    if annotation_content:
                        self._task_state.llm_result.message.content = annotation_content
                case QueueAgentThoughtEvent():
                    agent_thought_response = self._agent_thought_to_stream_response(event)
                    if agent_thought_response is not None:
                        yield agent_thought_response
                case QueueMessageFileEvent():
                    response = self._message_cycle_manager.message_file_to_stream_response(event)
                    if response:
                        yield response
                case QueueAgentMessageEvent():
                    chunk = event.chunk
                    delta_text = self._chunk_delta_text(chunk)
                    if delta_text is None:
                        continue
                    if self._generative_ui_enabled:
                        for part in self._openui_agent_parser.feed(delta_text):
                            if isinstance(part, OpenUIContentBlock):
                                if not self._generative_ui_suppressed:
                                    yield self._openui_to_stream_response(part)
                            else:
                                self._openui_live_prose += part
                                yield self._agent_message_to_stream_response(answer=part, message_id=self._message_id)
                        continue
                    yield self._agent_message_to_stream_response(
                        answer=delta_text,
                        message_id=self._message_id,
                    )
                case QueueLLMChunkEvent():
                    chunk = event.chunk
                    delta_text = self._chunk_delta_text(chunk)
                    if delta_text is None:
                        continue

                    if not self._task_state.llm_result.prompt_messages:
                        self._task_state.llm_result.prompt_messages = chunk.prompt_messages

                    if self._generative_ui_enabled:
                        for response in self._process_generative_ui_final_text(delta_text):
                            if publisher and isinstance(response, MessageStreamResponse):
                                text_chunk = chunk.model_copy(
                                    update={
                                        "delta": chunk.delta.model_copy(
                                            update={"message": AssistantPromptMessage(content=response.answer)}
                                        )
                                    }
                                )
                                publisher.publish(
                                    message.model_copy(update={"event": QueueLLMChunkEvent(chunk=text_chunk)})
                                )
                            yield response
                        continue

                    if self._handle_output_moderation_chunk(delta_text):
                        continue
                    current_content = cast(str, self._task_state.llm_result.message.content)
                    current_content += delta_text
                    self._task_state.llm_result.message.content = current_content

                    # Determine the event type once, on first LLM chunk, and reuse for subsequent chunks
                    if not hasattr(self, "_precomputed_event_type") or self._precomputed_event_type is None:
                        self._precomputed_event_type = self._message_cycle_manager.get_message_event_type(
                            message_id=self._message_id
                        )
                    yield self._message_cycle_manager.message_to_stream_response(
                        answer=delta_text,
                        message_id=self._message_id,
                        event_type=self._precomputed_event_type,
                    )
                case QueueMessageReplaceEvent():
                    replacement = event.text
                    if (
                        self._generative_ui_enabled
                        and event.reason == QueueMessageReplaceEvent.MessageReplaceReason.OUTPUT_MODERATION
                    ):
                        self._generative_ui_suppressed = True
                        self._task_state.metadata.content_blocks.clear()
                        replacement = extract_openui_prose(replacement)
                        self._task_state.llm_result.message.content = replacement
                    yield self._message_cycle_manager.message_replace_to_stream_response(
                        answer=replacement, reason=event.reason
                    )
                case QueuePingEvent():
                    yield self.ping_stream_response()
                case _:
                    continue
        if self._conversation_name_generate_thread:
            logger.debug("Conversation name generation running as daemon thread")

    def _openui_to_stream_response(self, block: OpenUIContentBlock) -> MessageContentStreamResponse:
        block = block.model_copy(update={"sequence": max(block.sequence, self._openui_sequences.get(block.id, 0) + 1)})
        self._openui_sequences[block.id] = block.sequence
        blocks = self._task_state.metadata.content_blocks
        previous: OpenUIContentBlock | None = None
        for index, current in enumerate(blocks):
            if current.id == block.id:
                previous = current
                blocks[index] = block
                break
        else:
            blocks.append(block)
        return MessageContentStreamResponse(
            task_id=self._application_generate_entity.task_id, data=encode_openui_update(block, previous)
        )

    def _process_generative_ui_final_text(self, text: str) -> Generator[StreamResponse]:
        """Reset the visible answer before authoritative replay, retaining sequence monotonicity.

        Live prose and final prose have separate coordinate systems. The explicit
        boundary lets clients clear live parts and blocks before any rebased UI
        snapshot, while keeping their separate agent activity history intact.
        """
        if not self._openui_final_started:
            self._openui_final_started = True
            for part in self._openui_agent_parser.finish("completed"):
                if isinstance(part, str):
                    yield self._agent_message_to_stream_response(answer=part, message_id=self._message_id)
            self._openui_live_prose = ""
            self._task_state.metadata.content_blocks.clear()
            if not self._generative_ui_suppressed:
                yield self._message_cycle_manager.message_replace_to_stream_response(
                    answer="", reason=QueueMessageReplaceEvent.MessageReplaceReason.GENERATIVE_UI_FINAL
                )
        for part in self._openui_parser.feed(text):
            if isinstance(part, OpenUIContentBlock):
                if not self._generative_ui_suppressed:
                    yield self._openui_to_stream_response(part)
            else:
                if self._handle_output_moderation_chunk(part):
                    continue
                current = self._task_state.llm_result.message.get_text_content()
                self._task_state.llm_result.message.content = current + part
                yield self._message_cycle_manager.message_to_stream_response(answer=part, message_id=self._message_id)

    def _finish_generative_ui(self, status: Literal["completed", "cancelled", "error"]) -> Generator[StreamResponse]:
        """Close content streams and retain live prose when no authoritative answer arrived.

        The partial marker tells history consumers that the saved answer already
        includes public prose retained in the separate agent activity records.
        """
        live_tail = [] if self._openui_final_started else self._openui_agent_parser.finish(status)
        for part in live_tail:
            if isinstance(part, OpenUIContentBlock):
                if not self._generative_ui_suppressed:
                    yield self._openui_to_stream_response(part)
            else:
                self._openui_live_prose += part
                yield self._agent_message_to_stream_response(answer=part, message_id=self._message_id)
        for part in self._openui_parser.finish(status):
            if isinstance(part, OpenUIContentBlock):
                if not self._generative_ui_suppressed:
                    yield self._openui_to_stream_response(part)
            else:
                current = self._task_state.llm_result.message.get_text_content()
                self._task_state.llm_result.message.content = current + part
                yield self._message_cycle_manager.message_to_stream_response(answer=part, message_id=self._message_id)
        if status != "completed" and not self._openui_final_started and not self._generative_ui_suppressed:
            self._task_state.llm_result.message.content = self._openui_live_prose
            self._openui_response_is_partial = True

    @staticmethod
    def _chunk_delta_text(chunk: LLMResultChunk) -> str | None:
        delta_content = chunk.delta.message.content
        if delta_content is None:
            return None
        if not isinstance(delta_content, list):
            return delta_content

        delta_text = ""
        # EasyUI streams text only; structured multimodal chunks contribute their text parts.
        for content in cast(list[object], delta_content):
            logger.debug("The content type %s in LLM chunk delta message content.: %r", type(content), content)
            match content:
                case TextPromptMessageContent():
                    delta_text += content.data
                case str():
                    delta_text += content
                case _:
                    logger.warning(
                        "Unsupported content type %s in LLM chunk delta message content.: %r",
                        type(content),
                        content,
                    )
                    continue
        return delta_text

    def _save_message(
        self,
        *,
        session: Session,
        trace_manager: TraceQueueManager | None = None,
        preserve_existing_usage: bool = False,
    ) -> Message:
        """
        Save message.

        UI offsets address exact streamed prose, so messages containing UI retain
        whitespace and template-shaped text unchanged after a history reload.
        :return:
        """
        llm_result = self._task_state.llm_result
        usage = llm_result.usage

        agent_stop_requested = preserve_existing_usage and self._app_config.app_mode == AppMode.AGENT
        message_stmt = select(Message).where(Message.id == self._message_id)
        if agent_stop_requested:
            message_stmt = message_stmt.with_for_update().execution_options(populate_existing=True)
        message = session.scalar(message_stmt)
        if not message:
            raise ValueError(f"message {self._message_id} not found")
        conversation_stmt = select(Conversation).where(Conversation.id == self._conversation_id)
        conversation = session.scalar(conversation_stmt)
        if not conversation:
            raise ValueError(f"Conversation {self._conversation_id} not found")

        saved_prompt = PromptMessageUtil.prompt_messages_to_prompt_for_saving(
            self._model_config.mode, self._task_state.llm_result.prompt_messages
        )
        object.__setattr__(message, "message", saved_prompt)
        try:
            existing_metadata = json.loads(message.message_metadata) if message.message_metadata else {}
        except (json.JSONDecodeError, TypeError):
            existing_metadata = {}
        if not isinstance(existing_metadata, dict):
            existing_metadata = {}
        has_persisted_usage = preserve_existing_usage and (
            int(message.message_tokens or 0) + int(message.answer_tokens or 0) > 0 or bool(message.total_price)
        )
        if not has_persisted_usage:
            message.message_tokens = usage.prompt_tokens
            message.message_unit_price = usage.prompt_unit_price
            message.message_price_unit = usage.prompt_price_unit
        answer = llm_result.message.get_text_content()
        message.answer = (
            answer
            if self._task_state.metadata.content_blocks or self._openui_response_is_partial
            else PromptTemplateParser.remove_template_variables(answer.strip())
        )
        message.updated_at = naive_utc_now()
        if not has_persisted_usage:
            message.answer_tokens = usage.completion_tokens
            message.answer_unit_price = usage.completion_unit_price
            message.answer_price_unit = usage.completion_price_unit
            message.provider_response_latency = time.perf_counter() - self.start_at
            message.total_price = usage.total_price
            message.currency = usage.currency
            self._task_state.llm_result.usage.latency = message.provider_response_latency
            self._task_state.metadata.usage = self._task_state.llm_result.usage

        metadata = self._task_state.metadata.model_dump(mode="json")
        if self._openui_response_is_partial:
            metadata["agent_response_is_partial"] = True
        if has_persisted_usage and "usage" in existing_metadata:
            metadata["usage"] = existing_metadata["usage"]
        if agent_stop_requested:
            # Closing the consumer records a request, not a runtime outcome.
            # The Agent worker owns the terminal after cancellation/cleanup.
            metadata["agent_stop_requested"] = True
        message.message_metadata = json.dumps(metadata, ensure_ascii=False)

        if trace_manager and not agent_stop_requested:
            trace_manager.add_trace_task(
                TraceTask(
                    TraceTaskName.MESSAGE_TRACE,
                    conversation_id=self._conversation_id,
                    message_id=self._message_id,
                    trace_session_id=self._application_generate_entity.extras.get("trace_session_id"),
                )
            )

        if not agent_stop_requested:
            message_was_created.send(
                message,
                application_generate_entity=self._application_generate_entity,
            )
        return message

    def _handle_stop(self, event: QueueStopEvent):
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
        self._task_state.llm_result.usage = model_type_instance.calc_response_usage(
            model, credentials, prompt_tokens, completion_tokens
        )

    def _message_end_to_stream_response(self) -> MessageEndStreamResponse:
        """
        Message end to stream response.
        :return:
        """
        self._task_state.metadata.usage = self._task_state.llm_result.usage
        metadata_dict = self._task_state.metadata.model_dump(exclude_none=True)
        if self._openui_response_is_partial:
            metadata_dict["agent_response_is_partial"] = True

        # Fetch files associated with this message
        files: Sequence[Mapping[str, Any]] = []
        with session_factory.create_session() as session:
            message_files = session.scalars(select(MessageFile).where(MessageFile.message_id == self._message_id)).all()

            if message_files:
                # Fetch all required UploadFile objects in a single query to avoid N+1 problem
                upload_file_ids = list(
                    dict.fromkeys(
                        mf.upload_file_id
                        for mf in message_files
                        if mf.transfer_method == FileTransferMethod.LOCAL_FILE and mf.upload_file_id
                    )
                )
                upload_files_map = {}
                if upload_file_ids:
                    upload_files = session.scalars(select(UploadFile).where(UploadFile.id.in_(upload_file_ids))).all()
                    upload_files_map = {uf.id: uf for uf in upload_files}

                files_list = []
                for message_file in message_files:
                    file_dict = prepare_file_dict(message_file, upload_files_map)
                    files_list.append(file_dict)

                files = cast(Sequence[Mapping[str, Any]], files_list)

        return MessageEndStreamResponse(
            task_id=self._application_generate_entity.task_id,
            id=self._message_id,
            metadata=metadata_dict,
            files=files,
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

    def _agent_thought_to_stream_response(self, event: QueueAgentThoughtEvent) -> AgentThoughtStreamResponse | None:
        """
        Agent thought to stream response.
        :param event: agent thought event
        :return:
        """
        with session_factory.create_session() as session:
            agent_thought: MessageAgentThought | None = session.scalar(
                select(MessageAgentThought).where(MessageAgentThought.id == event.agent_thought_id).limit(1)
            )

        if agent_thought:
            return AgentThoughtStreamResponse(
                task_id=self._application_generate_entity.task_id,
                id=agent_thought.id,
                position=agent_thought.position,
                thought=agent_thought.thought or "",
                observation=agent_thought.observation or "",
                tool=agent_thought.tool or "",
                tool_labels=agent_thought.tool_labels,
                tool_input=agent_thought.tool_input or "",
                message_files=agent_thought.files,
            )

        return None

    def _handle_output_moderation_chunk(self, text: str) -> bool:
        """
        Handle output moderation chunk.
        :param text: text
        :return: True if output moderation should direct output, otherwise False
        """
        if self.output_moderation_handler:
            if self.output_moderation_handler.should_direct_output():
                self._generative_ui_suppressed = True
                self._task_state.metadata.content_blocks.clear()
                # stop subscribe new token when output moderation should direct output
                self._task_state.llm_result.message.content = self.output_moderation_handler.get_final_output()
                self.queue_manager.publish(
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

                self.queue_manager.publish(
                    QueueStopEvent(stopped_by=QueueStopEvent.StopBy.OUTPUT_MODERATION), PublishFrom.TASK_PIPELINE
                )
                return True
            else:
                self.output_moderation_handler.append_new_token(text)

        return False
