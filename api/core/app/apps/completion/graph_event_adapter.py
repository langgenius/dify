from collections.abc import Mapping
from typing import Any, cast

from core.app.apps.base_app_queue_manager import AppQueueManager, PublishFrom
from core.app.entities.app_invoke_entities import CompletionAppGenerateEntity
from core.app.entities.queue_entities import (
    QueueErrorEvent,
    QueueLLMChunkEvent,
    QueueMessageEndEvent,
    QueueRetrieverResourcesEvent,
    QueueStopEvent,
)
from core.prompt.utils.prompt_message_util import SavedPrompt
from core.rag.entities import RetrievalSourceMetadata
from graphon.enums import BuiltinNodeTypes
from graphon.graph_events import (
    GraphEngineEvent,
    GraphRunAbortedEvent,
    GraphRunFailedEvent,
    GraphRunSucceededEvent,
    NodeRunExceptionEvent,
    NodeRunFailedEvent,
    NodeRunRetrieverResourceEvent,
    NodeRunStreamChunkEvent,
    NodeRunSucceededEvent,
)
from graphon.model_runtime.entities.llm_entities import LLMResult, LLMResultChunk, LLMResultChunkDelta, LLMUsage
from graphon.model_runtime.entities.message_entities import AssistantPromptMessage

_LLM_TEXT_SELECTOR_PREFIX = ("llm", "text")


class CompletionGraphEventAdapter:
    """Translate runtime workflow events into legacy Completion queue events."""

    _application_generate_entity: CompletionAppGenerateEntity
    _queue_manager: AppQueueManager
    _answer: str
    _usage: LLMUsage
    _saved_prompt: list[SavedPrompt]
    _chunk_index: int

    def __init__(
        self,
        *,
        application_generate_entity: CompletionAppGenerateEntity,
        queue_manager: AppQueueManager,
    ) -> None:
        self._application_generate_entity = application_generate_entity
        self._queue_manager = queue_manager
        self._answer = ""
        self._usage = LLMUsage.empty_usage()
        self._saved_prompt = []
        self._chunk_index = 0

    def handle_event(self, event: GraphEngineEvent) -> None:
        match event:
            case NodeRunStreamChunkEvent():
                self._handle_stream_chunk(event)
            case NodeRunRetrieverResourceEvent():
                self._handle_retriever_resource(event)
            case NodeRunSucceededEvent():
                self._handle_node_succeeded(event)
            case NodeRunFailedEvent() | NodeRunExceptionEvent():
                self._publish_error(event.error or event.node_run_result.error or "Node failed")
            case GraphRunSucceededEvent():
                self._publish_message_end(event.outputs)
            case GraphRunFailedEvent():
                self._publish_error(event.error)
            case GraphRunAbortedEvent():
                self._queue_manager.publish(
                    QueueStopEvent(stopped_by=QueueStopEvent.StopBy.USER_MANUAL),
                    PublishFrom.APPLICATION_MANAGER,
                )
            case _:
                return

    def _handle_stream_chunk(self, event: NodeRunStreamChunkEvent) -> None:
        if tuple(event.selector)[:2] != _LLM_TEXT_SELECTOR_PREFIX:
            return
        if event.is_final and not event.chunk:
            return

        self._answer += event.chunk
        self._queue_manager.publish(
            QueueLLMChunkEvent(
                chunk=LLMResultChunk(
                    model=self._application_generate_entity.model_conf.model,
                    prompt_messages=[],
                    delta=LLMResultChunkDelta(
                        index=self._chunk_index,
                        message=AssistantPromptMessage(content=event.chunk),
                    ),
                )
            ),
            PublishFrom.APPLICATION_MANAGER,
        )
        self._chunk_index += 1

    def _handle_retriever_resource(self, event: NodeRunRetrieverResourceEvent) -> None:
        self._queue_manager.publish(
            QueueRetrieverResourcesEvent(
                retriever_resources=[
                    RetrievalSourceMetadata.model_validate(resource) for resource in event.retriever_resources
                ],
                in_iteration_id=event.in_iteration_id,
                in_loop_id=event.in_loop_id,
            ),
            PublishFrom.APPLICATION_MANAGER,
        )

    def _handle_node_succeeded(self, event: NodeRunSucceededEvent) -> None:
        if event.node_type != BuiltinNodeTypes.LLM and event.node_id != "llm":
            return

        result = event.node_run_result
        text = result.outputs.get("text")
        if isinstance(text, str):
            self._answer = text
        self._usage = result.llm_usage

        prompts = result.process_data.get("prompts")
        if isinstance(prompts, list):
            self._saved_prompt = cast(list[SavedPrompt], prompts)

    def _publish_message_end(self, outputs: Mapping[str, object]) -> None:
        result = outputs.get("result")
        if isinstance(result, str) and not self._answer:
            self._answer = result

        self._queue_manager.publish(
            QueueMessageEndEvent(
                llm_result=LLMResult(
                    model=self._application_generate_entity.model_conf.model,
                    prompt_messages=[],
                    message=AssistantPromptMessage(content=self._answer),
                    usage=self._usage,
                ),
                saved_prompt=self._saved_prompt,
            ),
            PublishFrom.APPLICATION_MANAGER,
        )

    def _publish_error(self, error: Any) -> None:
        self._queue_manager.publish(
            QueueErrorEvent(error=ValueError(str(error))),
            PublishFrom.APPLICATION_MANAGER,
        )
