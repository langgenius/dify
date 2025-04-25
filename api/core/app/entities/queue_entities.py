from collections.abc import Mapping
from datetime import datetime
from enum import Enum, StrEnum
from typing import Any, Optional

from pydantic import BaseModel

from core.model_runtime.entities.llm_entities import LLMResult, LLMResultChunk
from core.workflow.entities.node_entities import AgentNodeStrategyInit, NodeRunMetadataKey
from core.workflow.graph_engine.entities.graph_runtime_state import GraphRuntimeState
from core.workflow.nodes import NodeType
from core.workflow.nodes.base import BaseNodeData


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
    PARALLEL_BRANCH_RUN_STARTED = "parallel_branch_run_started"
    PARALLEL_BRANCH_RUN_SUCCEEDED = "parallel_branch_run_succeeded"
    PARALLEL_BRANCH_RUN_FAILED = "parallel_branch_run_failed"
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
    inputs: Optional[Mapping[str, Any]] = None
    predecessor_node_id: Optional[str] = None
    metadata: Optional[Mapping[str, Any]] = None


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
    inputs: Optional[Mapping[str, Any]] = None
    outputs: Optional[Mapping[str, Any]] = None
    metadata: Optional[Mapping[str, Any]] = None
    steps: int = 0

    error: Optional[str] = None


class QueueLoopStartEvent(AppQueueEvent):
    """
    QueueLoopStartEvent entity
    """

    event: QueueEvent = QueueEvent.LOOP_START
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
    inputs: Optional[Mapping[str, Any]] = None
    predecessor_node_id: Optional[str] = None
    metadata: Optional[Mapping[str, Any]] = None


class QueueLoopNextEvent(AppQueueEvent):
    """
    QueueLoopNextEvent entity
    """

    event: QueueEvent = QueueEvent.LOOP_NEXT

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
    output: Optional[Any] = None  # output for the current loop
    duration: Optional[float] = None


class QueueLoopCompletedEvent(AppQueueEvent):
    """
    QueueLoopCompletedEvent entity
    """

    event: QueueEvent = QueueEvent.LOOP_COMPLETED

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
    inputs: Optional[Mapping[str, Any]] = None
    outputs: Optional[Mapping[str, Any]] = None
    metadata: Optional[Mapping[str, Any]] = None
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
    in_loop_id: Optional[str] = None
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
    retriever_resources: list[dict]
    in_iteration_id: Optional[str] = None
    """iteration id if node is in iteration"""
    in_loop_id: Optional[str] = None
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
    exceptions_count: int


class QueueWorkflowPartialSuccessEvent(AppQueueEvent):
    """
    QueueWorkflowFailedEvent entity
    """

    event: QueueEvent = QueueEvent.WORKFLOW_PARTIAL_SUCCEEDED
    exceptions_count: int
    outputs: Optional[dict[str, Any]] = None


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
    in_loop_id: Optional[str] = None
    """loop id if node is in loop"""
    start_at: datetime
    parallel_mode_run_id: Optional[str] = None
    """iteratoin run in parallel mode run id"""
    agent_strategy: Optional[AgentNodeStrategyInit] = None


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
    in_loop_id: Optional[str] = None
    """loop id if node is in loop"""
    start_at: datetime

    inputs: Optional[Mapping[str, Any]] = None
    process_data: Optional[Mapping[str, Any]] = None
    outputs: Optional[Mapping[str, Any]] = None
    execution_metadata: Optional[Mapping[NodeRunMetadataKey, Any]] = None

    error: Optional[str] = None
    """single iteration duration map"""
    iteration_duration_map: Optional[dict[str, float]] = None
    """single loop duration map"""
    loop_duration_map: Optional[dict[str, float]] = None


class QueueAgentLogEvent(AppQueueEvent):
    """
    QueueAgentLogEvent entity
    """

    event: QueueEvent = QueueEvent.AGENT_LOG
    id: str
    label: str
    node_execution_id: str
    parent_id: str | None
    error: str | None
    status: str
    data: Mapping[str, Any]
    metadata: Optional[Mapping[str, Any]] = None
    node_id: str


class QueueNodeRetryEvent(QueueNodeStartedEvent):
    """QueueNodeRetryEvent entity"""

    event: QueueEvent = QueueEvent.RETRY

    inputs: Optional[Mapping[str, Any]] = None
    process_data: Optional[Mapping[str, Any]] = None
    outputs: Optional[Mapping[str, Any]] = None
    execution_metadata: Optional[Mapping[NodeRunMetadataKey, Any]] = None

    error: str
    retry_index: int  # retry index


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
    in_loop_id: Optional[str] = None
    """loop id if node is in loop"""
    start_at: datetime

    inputs: Optional[Mapping[str, Any]] = None
    process_data: Optional[Mapping[str, Any]] = None
    outputs: Optional[Mapping[str, Any]] = None
    execution_metadata: Optional[Mapping[NodeRunMetadataKey, Any]] = None

    error: str


class QueueNodeInLoopFailedEvent(AppQueueEvent):
    """
    QueueNodeInLoopFailedEvent entity
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
    in_loop_id: Optional[str] = None
    """loop id if node is in loop"""
    start_at: datetime

    inputs: Optional[Mapping[str, Any]] = None
    process_data: Optional[Mapping[str, Any]] = None
    outputs: Optional[Mapping[str, Any]] = None
    execution_metadata: Optional[Mapping[NodeRunMetadataKey, Any]] = None

    error: str


class QueueNodeExceptionEvent(AppQueueEvent):
    """
    QueueNodeExceptionEvent entity
    """

    event: QueueEvent = QueueEvent.NODE_EXCEPTION

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
    in_loop_id: Optional[str] = None
    """loop id if node is in loop"""
    start_at: datetime

    inputs: Optional[Mapping[str, Any]] = None
    process_data: Optional[Mapping[str, Any]] = None
    outputs: Optional[Mapping[str, Any]] = None
    execution_metadata: Optional[Mapping[NodeRunMetadataKey, Any]] = None

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
    in_loop_id: Optional[str] = None
    """loop id if node is in loop"""
    start_at: datetime

    inputs: Optional[Mapping[str, Any]] = None
    process_data: Optional[Mapping[str, Any]] = None
    outputs: Optional[Mapping[str, Any]] = None
    execution_metadata: Optional[Mapping[NodeRunMetadataKey, Any]] = None

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
    in_loop_id: Optional[str] = None
    """loop id if node is in loop"""


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
    in_loop_id: Optional[str] = None
    """loop id if node is in loop"""


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
    in_loop_id: Optional[str] = None
    """loop id if node is in loop"""
    error: str
