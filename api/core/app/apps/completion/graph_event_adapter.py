from collections.abc import Sequence

from core.app.apps.base_app_queue_manager import AppQueueManager, PublishFrom
from core.app.entities.app_invoke_entities import CompletionAppGenerateEntity
from core.app.entities.queue_entities import (
    QueueErrorEvent,
    QueueLLMChunkEvent,
    QueueMessageEndEvent,
    QueueRetrieverResourcesEvent,
    QueueStopEvent,
)
from core.rag.entities import RetrievalSourceMetadata
from graphon.graph_events import (
    GraphEngineEvent,
    GraphRunAbortedEvent,
    GraphRunFailedEvent,
    GraphRunSucceededEvent,
    NodeRunRetrieverResourceEvent,
    NodeRunStreamChunkEvent,
    NodeRunSucceededEvent,
)
from graphon.model_runtime.entities.llm_entities import LLMResult, LLMResultChunk, LLMResultChunkDelta, LLMUsage
from graphon.model_runtime.entities.message_entities import AssistantPromptMessage, PromptMessage

_LLM_TEXT_SELECTOR_PREFIX = ("llm", "text")


class CompletionGraphEventAdapter:
    """Translate one runtime graph run into legacy Completion queue events."""

    def __init__(
        self,
        *,
        application_generate_entity: CompletionAppGenerateEntity,
        queue_manager: AppQueueManager,
    ) -> None:
        self._application_generate_entity = application_generate_entity
        self._queue_manager = queue_manager
        self._usage = LLMUsage.empty_usage()
        self._prompt_messages: list[PromptMessage] = []
        self._chunk_index = 0

    def set_prompt_messages(self, prompt_messages: Sequence[PromptMessage]) -> None:
        """Capture the final GraphOn prompt for legacy chunks and message persistence."""
        self._prompt_messages = list(prompt_messages)

    def handle_event(self, event: GraphEngineEvent) -> None:
        match event:
            case NodeRunStreamChunkEvent():
                self._handle_stream_chunk(event)
            case NodeRunRetrieverResourceEvent():
                self._handle_retriever_resource(event)
            case NodeRunSucceededEvent() if event.node_id == "llm":
                self._usage = event.node_run_result.llm_usage
            case GraphRunSucceededEvent():
                self._publish_message_end(event.outputs.get("result"))
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

        self._queue_manager.publish(
            QueueLLMChunkEvent(
                chunk=LLMResultChunk(
                    model=self._application_generate_entity.model_conf.model,
                    prompt_messages=self._prompt_messages,
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
        additional_features = self._application_generate_entity.app_config.additional_features
        if not additional_features or not additional_features.show_retrieve_source:
            return

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

    def _publish_message_end(self, result: object) -> None:
        self._queue_manager.publish(
            QueueMessageEndEvent(
                llm_result=LLMResult(
                    model=self._application_generate_entity.model_conf.model,
                    prompt_messages=self._prompt_messages,
                    message=AssistantPromptMessage(content=result if isinstance(result, str) else ""),
                    usage=self._usage,
                )
            ),
            PublishFrom.APPLICATION_MANAGER,
        )

    def _publish_error(self, error: object) -> None:
        self._queue_manager.publish(
            QueueErrorEvent(error=ValueError(str(error))),
            PublishFrom.APPLICATION_MANAGER,
        )
