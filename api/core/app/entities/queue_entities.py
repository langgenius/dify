from datetime import datetime
from enum import Enum
from typing import Any, Optional

from pydantic import BaseModel, field_validator

from core.model_runtime.entities.llm_entities import LLMResult, LLMResultChunk
from core.workflow.entities.node_entities import NodeRunMetadataKey
from core.workflow.graph_engine.entities.graph_runtime_state import GraphRuntimeState
from core.workflow.nodes import NodeType
from core.workflow.nodes.base import BaseNodeData


class QueueEvent(str, Enum):
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
    ITERATION_START = "iteration_start"
    ITERATION_NEXT = "iteration_next"
    ITERATION_COMPLETED = "iteration_completed"
    NODE_STARTED = "node_started"
    NODE_SUCCEEDED = "node_succeeded"
    NODE_FAILED = "node_failed"
    RETRIEVER_RESOURCES = "retriever_resources"
    ANNOTATION_REPLY = "annotation_reply"
    AGENT_THOUGHT = "agent_thought"
    MESSAGE_FILE = "message_file"
    PARALLEL_BRANCH_RUN_STARTED = "parallel_branch_run_started"
    PARALLEL_BRANCH_RUN_SUCCEEDED = "parallel_branch_run_succeeded"
    PARALLEL_BRANCH_RUN_FAILED = "parallel_branch_run_failed"
    ERROR = "error"
    PING = "ping"
    STOP = "stop"


class AppQueueEvent(BaseModel):
    """
    QueueEvent abstract entity
    """

    event: QueueEvent


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
    node_data: BaseNodeData
    parallel_id: Optional[str] = None
    """parallel id if node is in parallel"""
    parallel_start_node_id: Optional[str] = None
    """parallel start node id if node is in parallel"""
    parent_parallel_id: Optional[str] = None
    """parent parallel id if node is in parallel"""
    parent_parallel_start_node_id: Optional[str] = None
    """parent parallel start node id if node is in parallel"""
    start_at: datetime

    node_run_index: int
    inputs: Optional[dict[str, Any]] = None
    predecessor_node_id: Optional[str] = None
    metadata: Optional[dict[str, Any]] = None


class QueueIterationNextEvent(AppQueueEvent):
    """
    QueueIterationNextEvent entity
    """

    event: QueueEvent = QueueEvent.ITERATION_NEXT

    index: int
    node_execution_id: str
    node_id: str
    node_type: NodeType
    node_data: BaseNodeData
    parallel_id: Optional[str] = None
    """parallel id if node is in parallel"""
    parallel_start_node_id: Optional[str] = None
    """parallel start node id if node is in parallel"""
    parent_parallel_id: Optional[str] = None
    """parent parallel id if node is in parallel"""
    parent_parallel_start_node_id: Optional[str] = None
    """parent parallel start node id if node is in parallel"""
    parallel_mode_run_id: Optional[str] = None
    """iteratoin run in parallel mode run id"""
    node_run_index: int
    output: Optional[Any] = None  # output for the current iteration
    duration: Optional[float] = None

    @field_validator("output", mode="before")
    @classmethod
    def set_output(cls, v):
        """
        Set output
        """
        if v is None:
            return None
        if isinstance(v, int | float | str | bool | dict | list):
            return v
        raise ValueError("output must be a valid type")


class QueueIterationCompletedEvent(AppQueueEvent):
    """
    QueueIterationCompletedEvent entity
    """

    event: QueueEvent = QueueEvent.ITERATION_COMPLETED

    node_execution_id: str
    node_id: str
    node_type: NodeType
    node_data: BaseNodeData
    parallel_id: Optional[str] = None
    """parallel id if node is in parallel"""
    parallel_start_node_id: Optional[str] = None
    """parallel start node id if node is in parallel"""
    parent_parallel_id: Optional[str] = None
    """parent parallel id if node is in parallel"""
    parent_parallel_start_node_id: Optional[str] = None
    """parent parallel start node id if node is in parallel"""
    start_at: datetime

    node_run_index: int
    inputs: Optional[dict[str, Any]] = None
    outputs: Optional[dict[str, Any]] = None
    metadata: Optional[dict[str, Any]] = None
    steps: int = 0

    error: Optional[str] = None


class QueueTextChunkEvent(AppQueueEvent):
    """
    QueueTextChunkEvent entity
    """

    event: QueueEvent = QueueEvent.TEXT_CHUNK
    text: str
    from_variable_selector: Optional[list[str]] = None
    """from variable selector"""
    in_iteration_id: Optional[str] = None
    """iteration id if node is in iteration"""


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

    event: QueueEvent = QueueEvent.MESSAGE_REPLACE
    text: str


class QueueRetrieverResourcesEvent(AppQueueEvent):
    """
    QueueRetrieverResourcesEvent entity
    """

    event: QueueEvent = QueueEvent.RETRIEVER_RESOURCES
    retriever_resources: list[dict]
    in_iteration_id: Optional[str] = None
    """iteration id if node is in iteration"""


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
    llm_result: Optional[LLMResult] = None


class QueueAdvancedChatMessageEndEvent(AppQueueEvent):
    """
    QueueAdvancedChatMessageEndEvent entity
    """

    event: QueueEvent = QueueEvent.ADVANCED_CHAT_MESSAGE_END


class QueueWorkflowStartedEvent(AppQueueEvent):
    """
    QueueWorkflowStartedEvent entity
    """

    event: QueueEvent = QueueEvent.WORKFLOW_STARTED
    graph_runtime_state: GraphRuntimeState


class QueueWorkflowSucceededEvent(AppQueueEvent):
    """
    QueueWorkflowSucceededEvent entity
    """

    event: QueueEvent = QueueEvent.WORKFLOW_SUCCEEDED
    outputs: Optional[dict[str, Any]] = None


class QueueWorkflowFailedEvent(AppQueueEvent):
    """
    QueueWorkflowFailedEvent entity
    """

    event: QueueEvent = QueueEvent.WORKFLOW_FAILED
    error: str


class QueueNodeStartedEvent(AppQueueEvent):
    """
    QueueNodeStartedEvent entity
    """

    event: QueueEvent = QueueEvent.NODE_STARTED

    node_execution_id: str
    node_id: str
    node_type: NodeType
    node_data: BaseNodeData
    node_run_index: int = 1
    predecessor_node_id: Optional[str] = None
    parallel_id: Optional[str] = None
    """parallel id if node is in parallel"""
    parallel_start_node_id: Optional[str] = None
    """parallel start node id if node is in parallel"""
    parent_parallel_id: Optional[str] = None
    """parent parallel id if node is in parallel"""
    parent_parallel_start_node_id: Optional[str] = None
    """parent parallel start node id if node is in parallel"""
    in_iteration_id: Optional[str] = None
    """iteration id if node is in iteration"""
    start_at: datetime
    parallel_mode_run_id: Optional[str] = None
    """iteratoin run in parallel mode run id"""


class QueueNodeSucceededEvent(AppQueueEvent):
    """
    QueueNodeSucceededEvent entity
    """

    event: QueueEvent = QueueEvent.NODE_SUCCEEDED

    node_execution_id: str
    node_id: str
    node_type: NodeType
    node_data: BaseNodeData
    parallel_id: Optional[str] = None
    """parallel id if node is in parallel"""
    parallel_start_node_id: Optional[str] = None
    """parallel start node id if node is in parallel"""
    parent_parallel_id: Optional[str] = None
    """parent parallel id if node is in parallel"""
    parent_parallel_start_node_id: Optional[str] = None
    """parent parallel start node id if node is in parallel"""
    in_iteration_id: Optional[str] = None
    """iteration id if node is in iteration"""
    start_at: datetime

    inputs: Optional[dict[str, Any]] = None
    process_data: Optional[dict[str, Any]] = None
    outputs: Optional[dict[str, Any]] = None
    execution_metadata: Optional[dict[NodeRunMetadataKey, Any]] = None

    error: Optional[str] = None
    """single iteration duration map"""
    iteration_duration_map: Optional[dict[str, float]] = None


class QueueNodeInIterationFailedEvent(AppQueueEvent):
    """
    QueueNodeInIterationFailedEvent entity
    """

    event: QueueEvent = QueueEvent.NODE_FAILED

    node_execution_id: str
    node_id: str
    node_type: NodeType
    node_data: BaseNodeData
    parallel_id: Optional[str] = None
    """parallel id if node is in parallel"""
    parallel_start_node_id: Optional[str] = None
    """parallel start node id if node is in parallel"""
    parent_parallel_id: Optional[str] = None
    """parent parallel id if node is in parallel"""
    parent_parallel_start_node_id: Optional[str] = None
    """parent parallel start node id if node is in parallel"""
    in_iteration_id: Optional[str] = None
    """iteration id if node is in iteration"""
    start_at: datetime

    inputs: Optional[dict[str, Any]] = None
    process_data: Optional[dict[str, Any]] = None
    outputs: Optional[dict[str, Any]] = None
    execution_metadata: Optional[dict[NodeRunMetadataKey, Any]] = None

    error: str


class QueueNodeFailedEvent(AppQueueEvent):
    """
    QueueNodeFailedEvent entity
    """

    event: QueueEvent = QueueEvent.NODE_FAILED

    node_execution_id: str
    node_id: str
    node_type: NodeType
    node_data: BaseNodeData
    parallel_id: Optional[str] = None
    """parallel id if node is in parallel"""
    parallel_start_node_id: Optional[str] = None
    """parallel start node id if node is in parallel"""
    parent_parallel_id: Optional[str] = None
    """parent parallel id if node is in parallel"""
    parent_parallel_start_node_id: Optional[str] = None
    """parent parallel start node id if node is in parallel"""
    in_iteration_id: Optional[str] = None
    """iteration id if node is in iteration"""
    start_at: datetime

    inputs: Optional[dict[str, Any]] = None
    process_data: Optional[dict[str, Any]] = None
    outputs: Optional[dict[str, Any]] = None
    execution_metadata: Optional[dict[NodeRunMetadataKey, Any]] = None

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

    class StopBy(Enum):
        """
        Stop by enum
        """

        USER_MANUAL = "user-manual"
        ANNOTATION_REPLY = "annotation-reply"
        OUTPUT_MODERATION = "output-moderation"
        INPUT_MODERATION = "input-moderation"

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


class QueueParallelBranchRunStartedEvent(AppQueueEvent):
    """
    QueueParallelBranchRunStartedEvent entity
    """

    event: QueueEvent = QueueEvent.PARALLEL_BRANCH_RUN_STARTED

    parallel_id: str
    parallel_start_node_id: str
    parent_parallel_id: Optional[str] = None
    """parent parallel id if node is in parallel"""
    parent_parallel_start_node_id: Optional[str] = None
    """parent parallel start node id if node is in parallel"""
    in_iteration_id: Optional[str] = None
    """iteration id if node is in iteration"""


class QueueParallelBranchRunSucceededEvent(AppQueueEvent):
    """
    QueueParallelBranchRunSucceededEvent entity
    """

    event: QueueEvent = QueueEvent.PARALLEL_BRANCH_RUN_SUCCEEDED

    parallel_id: str
    parallel_start_node_id: str
    parent_parallel_id: Optional[str] = None
    """parent parallel id if node is in parallel"""
    parent_parallel_start_node_id: Optional[str] = None
    """parent parallel start node id if node is in parallel"""
    in_iteration_id: Optional[str] = None
    """iteration id if node is in iteration"""


class QueueParallelBranchRunFailedEvent(AppQueueEvent):
    """
    QueueParallelBranchRunFailedEvent entity
    """

    event: QueueEvent = QueueEvent.PARALLEL_BRANCH_RUN_FAILED

    parallel_id: str
    parallel_start_node_id: str
    parent_parallel_id: Optional[str] = None
    """parent parallel id if node is in parallel"""
    parent_parallel_start_node_id: Optional[str] = None
    """parent parallel start node id if node is in parallel"""
    in_iteration_id: Optional[str] = None
    """iteration id if node is in iteration"""
    error: str
