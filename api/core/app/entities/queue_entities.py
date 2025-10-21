from collections.abc import Mapping, Sequence
from datetime import datetime
from enum import StrEnum, auto
from typing import Any

from pydantic import BaseModel, ConfigDict, Field

from core.model_runtime.entities.llm_entities import LLMResult, LLMResultChunk
from core.rag.entities.citation_metadata import RetrievalSourceMetadata
from core.workflow.entities import AgentNodeStrategyInit
from core.workflow.enums import WorkflowNodeExecutionMetadataKey
from core.workflow.nodes import NodeType


class QueueEvent(StrEnum):
    """
    QueueEvent enum
    """

    LLM_CHUNK = "llm_chunk"
    TEXT_CHUNK = "text_chunk"
    AGENT_MESSAGE = "agent_message"
    MESSAGE_REPLACE = "message_replace"
    MESSAGE_END = "message_end"
    ADVANCED_CHAT_MESSAGE_END = "advanced_chat_message_end"
    WORKFLOW_STARTED = "workflow_started"
    WORKFLOW_SUCCEEDED = "workflow_succeeded"
    WORKFLOW_FAILED = "workflow_failed"
    WORKFLOW_PARTIAL_SUCCEEDED = "workflow_partial_succeeded"
    ITERATION_START = "iteration_start"
    ITERATION_NEXT = "iteration_next"
    ITERATION_COMPLETED = "iteration_completed"
    LOOP_START = "loop_start"
    LOOP_NEXT = "loop_next"
    LOOP_COMPLETED = "loop_completed"
    NODE_STARTED = "node_started"
    NODE_SUCCEEDED = "node_succeeded"
    NODE_FAILED = "node_failed"
    NODE_EXCEPTION = "node_exception"
    RETRIEVER_RESOURCES = "retriever_resources"
    ANNOTATION_REPLY = "annotation_reply"
    AGENT_THOUGHT = "agent_thought"
    MESSAGE_FILE = "message_file"
    AGENT_LOG = "agent_log"
    ERROR = "error"
    PING = "ping"
    STOP = "stop"
    RETRY = "retry"


class AppQueueEvent(BaseModel):
    """
    QueueEvent abstract entity
    """

    event: QueueEvent
    model_config = ConfigDict(arbitrary_types_allowed=True)


class QueueLLMChunkEvent(AppQueueEvent):
    """
    QueueLLMChunkEvent entity
    Only for basic mode apps
    """

    event: QueueEvent = QueueEvent.LLM_CHUNK
    chunk: LLMResultChunk


class QueueIterationStartEvent(AppQueueEvent):
    """
    QueueIterationStartEvent entity
    """

    event: QueueEvent = QueueEvent.ITERATION_START
    node_execution_id: str
    node_id: str
    node_type: NodeType
    node_title: str
    start_at: datetime

    node_run_index: int
    inputs: Mapping[str, object] = Field(default_factory=dict)
    metadata: Mapping[str, object] = Field(default_factory=dict)


class QueueIterationNextEvent(AppQueueEvent):
    """
    QueueIterationNextEvent entity
    """

    event: QueueEvent = QueueEvent.ITERATION_NEXT

    index: int
    node_execution_id: str
    node_id: str
    node_type: NodeType
    node_title: str
    node_run_index: int
    output: Any = None  # output for the current iteration


class QueueIterationCompletedEvent(AppQueueEvent):
    """
    QueueIterationCompletedEvent entity
    """

    event: QueueEvent = QueueEvent.ITERATION_COMPLETED

    node_execution_id: str
    node_id: str
    node_type: NodeType
    node_title: str
    start_at: datetime

    node_run_index: int
    inputs: Mapping[str, object] = Field(default_factory=dict)
    outputs: Mapping[str, object] = Field(default_factory=dict)
    metadata: Mapping[str, object] = Field(default_factory=dict)
    steps: int = 0

    error: str | None = None


class QueueLoopStartEvent(AppQueueEvent):
    """
    QueueLoopStartEvent entity
    """

    event: QueueEvent = QueueEvent.LOOP_START
    node_execution_id: str
    node_id: str
    node_type: NodeType
    node_title: str
    start_at: datetime

    node_run_index: int
    inputs: Mapping[str, object] = Field(default_factory=dict)
    metadata: Mapping[str, object] = Field(default_factory=dict)


class QueueLoopNextEvent(AppQueueEvent):
    """
    QueueLoopNextEvent entity
    """

    event: QueueEvent = QueueEvent.LOOP_NEXT

    index: int
    node_execution_id: str
    node_id: str
    node_type: NodeType
    node_title: str
    node_run_index: int
    output: Any = None  # output for the current loop


class QueueLoopCompletedEvent(AppQueueEvent):
    """
    QueueLoopCompletedEvent entity
    """

    event: QueueEvent = QueueEvent.LOOP_COMPLETED

    node_execution_id: str
    node_id: str
    node_type: NodeType
    node_title: str
    start_at: datetime

    node_run_index: int
    inputs: Mapping[str, object] = Field(default_factory=dict)
    outputs: Mapping[str, object] = Field(default_factory=dict)
    metadata: Mapping[str, object] = Field(default_factory=dict)
    steps: int = 0

    error: str | None = None


class QueueTextChunkEvent(AppQueueEvent):
    """
    QueueTextChunkEvent entity
    """

    event: QueueEvent = QueueEvent.TEXT_CHUNK
    text: str
    from_variable_selector: list[str] | None = None
    """from variable selector"""
    in_iteration_id: str | None = None
    """iteration id if node is in iteration"""
    in_loop_id: str | None = None
    """loop id if node is in loop"""


class QueueAgentMessageEvent(AppQueueEvent):
    """
    QueueMessageEvent entity
    """

    event: QueueEvent = QueueEvent.AGENT_MESSAGE
    chunk: LLMResultChunk


class QueueMessageReplaceEvent(AppQueueEvent):
    """
    QueueMessageReplaceEvent entity
    """

    class MessageReplaceReason(StrEnum):
        """
        Reason for message replace event
        """

        OUTPUT_MODERATION = "output_moderation"

    event: QueueEvent = QueueEvent.MESSAGE_REPLACE
    text: str
    reason: str


class QueueRetrieverResourcesEvent(AppQueueEvent):
    """
    QueueRetrieverResourcesEvent entity
    """

    event: QueueEvent = QueueEvent.RETRIEVER_RESOURCES
    retriever_resources: Sequence[RetrievalSourceMetadata]
    in_iteration_id: str | None = None
    """iteration id if node is in iteration"""
    in_loop_id: str | None = None
    """loop id if node is in loop"""


class QueueAnnotationReplyEvent(AppQueueEvent):
    """
    QueueAnnotationReplyEvent entity
    """

    event: QueueEvent = QueueEvent.ANNOTATION_REPLY
    message_annotation_id: str


class QueueMessageEndEvent(AppQueueEvent):
    """
    QueueMessageEndEvent entity
    """

    event: QueueEvent = QueueEvent.MESSAGE_END
    llm_result: LLMResult | None = None


class QueueAdvancedChatMessageEndEvent(AppQueueEvent):
    """
    QueueAdvancedChatMessageEndEvent entity
    """

    event: QueueEvent = QueueEvent.ADVANCED_CHAT_MESSAGE_END


class QueueWorkflowStartedEvent(AppQueueEvent):
    """QueueWorkflowStartedEvent entity."""

    event: QueueEvent = QueueEvent.WORKFLOW_STARTED


class QueueWorkflowSucceededEvent(AppQueueEvent):
    """
    QueueWorkflowSucceededEvent entity
    """

    event: QueueEvent = QueueEvent.WORKFLOW_SUCCEEDED
    outputs: Mapping[str, object] = Field(default_factory=dict)


class QueueWorkflowFailedEvent(AppQueueEvent):
    """
    QueueWorkflowFailedEvent entity
    """

    event: QueueEvent = QueueEvent.WORKFLOW_FAILED
    error: str
    exceptions_count: int


class QueueWorkflowPartialSuccessEvent(AppQueueEvent):
    """
    QueueWorkflowFailedEvent entity
    """

    event: QueueEvent = QueueEvent.WORKFLOW_PARTIAL_SUCCEEDED
    exceptions_count: int
    outputs: Mapping[str, object] = Field(default_factory=dict)


class QueueNodeStartedEvent(AppQueueEvent):
    """
    QueueNodeStartedEvent entity
    """

    event: QueueEvent = QueueEvent.NODE_STARTED

    node_execution_id: str
    node_id: str
    node_title: str
    node_type: NodeType
    node_run_index: int = 1  # FIXME(-LAN-): may not used
    in_iteration_id: str | None = None
    in_loop_id: str | None = None
    start_at: datetime
    agent_strategy: AgentNodeStrategyInit | None = None

    # FIXME(-LAN-): only for ToolNode, need to refactor
    provider_type: str  # should be a core.tools.entities.tool_entities.ToolProviderType
    provider_id: str


class QueueNodeSucceededEvent(AppQueueEvent):
    """
    QueueNodeSucceededEvent entity
    """

    event: QueueEvent = QueueEvent.NODE_SUCCEEDED

    node_execution_id: str
    node_id: str
    node_type: NodeType
    in_iteration_id: str | None = None
    """iteration id if node is in iteration"""
    in_loop_id: str | None = None
    """loop id if node is in loop"""
    start_at: datetime

    inputs: Mapping[str, object] = Field(default_factory=dict)
    process_data: Mapping[str, object] = Field(default_factory=dict)
    outputs: Mapping[str, object] = Field(default_factory=dict)
    execution_metadata: Mapping[WorkflowNodeExecutionMetadataKey, Any] | None = None

    error: str | None = None


class QueueAgentLogEvent(AppQueueEvent):
    """
    QueueAgentLogEvent entity
    """

    event: QueueEvent = QueueEvent.AGENT_LOG
    id: str
    label: str
    node_execution_id: str
    parent_id: str | None = None
    error: str | None = None
    status: str
    data: Mapping[str, Any]
    metadata: Mapping[str, object] = Field(default_factory=dict)
    node_id: str


class QueueNodeRetryEvent(QueueNodeStartedEvent):
    """QueueNodeRetryEvent entity"""

    event: QueueEvent = QueueEvent.RETRY

    inputs: Mapping[str, object] = Field(default_factory=dict)
    process_data: Mapping[str, object] = Field(default_factory=dict)
    outputs: Mapping[str, object] = Field(default_factory=dict)
    execution_metadata: Mapping[WorkflowNodeExecutionMetadataKey, Any] | None = None

    error: str
    retry_index: int  # retry index


class QueueNodeExceptionEvent(AppQueueEvent):
    """
    QueueNodeExceptionEvent entity
    """

    event: QueueEvent = QueueEvent.NODE_EXCEPTION

    node_execution_id: str
    node_id: str
    node_type: NodeType
    in_iteration_id: str | None = None
    """iteration id if node is in iteration"""
    in_loop_id: str | None = None
    """loop id if node is in loop"""
    start_at: datetime

    inputs: Mapping[str, object] = Field(default_factory=dict)
    process_data: Mapping[str, object] = Field(default_factory=dict)
    outputs: Mapping[str, object] = Field(default_factory=dict)
    execution_metadata: Mapping[WorkflowNodeExecutionMetadataKey, Any] | None = None

    error: str


class QueueNodeFailedEvent(AppQueueEvent):
    """
    QueueNodeFailedEvent entity
    """

    event: QueueEvent = QueueEvent.NODE_FAILED

    node_execution_id: str
    node_id: str
    node_type: NodeType
    in_iteration_id: str | None = None
    """iteration id if node is in iteration"""
    in_loop_id: str | None = None
    """loop id if node is in loop"""
    start_at: datetime

    inputs: Mapping[str, object] = Field(default_factory=dict)
    process_data: Mapping[str, object] = Field(default_factory=dict)
    outputs: Mapping[str, object] = Field(default_factory=dict)
    execution_metadata: Mapping[WorkflowNodeExecutionMetadataKey, Any] | None = None

    error: str


class QueueAgentThoughtEvent(AppQueueEvent):
    """
    QueueAgentThoughtEvent entity
    """

    event: QueueEvent = QueueEvent.AGENT_THOUGHT
    agent_thought_id: str


class QueueMessageFileEvent(AppQueueEvent):
    """
    QueueAgentThoughtEvent entity
    """

    event: QueueEvent = QueueEvent.MESSAGE_FILE
    message_file_id: str


class QueueErrorEvent(AppQueueEvent):
    """
    QueueErrorEvent entity
    """

    event: QueueEvent = QueueEvent.ERROR
    error: Any = None


class QueuePingEvent(AppQueueEvent):
    """
    QueuePingEvent entity
    """

    event: QueueEvent = QueueEvent.PING


class QueueStopEvent(AppQueueEvent):
    """
    QueueStopEvent entity
    """

    class StopBy(StrEnum):
        """
        Stop by enum
        """

        USER_MANUAL = auto()
        ANNOTATION_REPLY = auto()
        OUTPUT_MODERATION = auto()
        INPUT_MODERATION = auto()

    event: QueueEvent = QueueEvent.STOP
    stopped_by: StopBy

    def get_stop_reason(self) -> str:
        """
        To stop reason
        """
        reason_mapping = {
            QueueStopEvent.StopBy.USER_MANUAL: "Stopped by user.",
            QueueStopEvent.StopBy.ANNOTATION_REPLY: "Stopped by annotation reply.",
            QueueStopEvent.StopBy.OUTPUT_MODERATION: "Stopped by output moderation.",
            QueueStopEvent.StopBy.INPUT_MODERATION: "Stopped by input moderation.",
        }

        return reason_mapping.get(self.stopped_by, "Stopped by unknown reason.")


class QueueMessage(BaseModel):
    """
    QueueMessage abstract entity
    """

    task_id: str
    app_mode: str
    event: AppQueueEvent


class MessageQueueMessage(QueueMessage):
    """
    MessageQueueMessage entity
    """

    message_id: str
    conversation_id: str


class WorkflowQueueMessage(QueueMessage):
    """
    WorkflowQueueMessage entity
    """

    pass
