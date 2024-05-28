from enum import Enum
from typing import Any, Optional

from pydantic import BaseModel, validator

from core.model_runtime.entities.llm_entities import LLMResult, LLMResultChunk
from core.workflow.entities.base_node_data_entities import BaseNodeData
from core.workflow.entities.node_entities import NodeType


class QueueEvent(Enum):
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
    ERROR = "error"
    PING = "ping"
    STOP = "stop"


class AppQueueEvent(BaseModel):
    """
    QueueEvent entity
    """
    event: QueueEvent


class QueueLLMChunkEvent(AppQueueEvent):
    """
    QueueLLMChunkEvent entity
    """
    event = QueueEvent.LLM_CHUNK
    chunk: LLMResultChunk

class QueueIterationStartEvent(AppQueueEvent):
    """
    QueueIterationStartEvent entity
    """
    event = QueueEvent.ITERATION_START
    node_id: str
    node_type: NodeType
    node_data: BaseNodeData

    node_run_index: int
    inputs: dict = None
    predecessor_node_id: Optional[str] = None
    metadata: Optional[dict] = None

class QueueIterationNextEvent(AppQueueEvent):
    """
    QueueIterationNextEvent entity
    """
    event = QueueEvent.ITERATION_NEXT

    index: int
    node_id: str
    node_type: NodeType

    node_run_index: int
    output: Optional[Any] # output for the current iteration

    @validator('output', pre=True, always=True)
    def set_output(cls, v):
        """
        Set output
        """
        if v is None:
            return None
        if isinstance(v, int | float | str | bool | dict | list):
            return v
        raise ValueError('output must be a valid type')

class QueueIterationCompletedEvent(AppQueueEvent):
    """
    QueueIterationCompletedEvent entity
    """
    event = QueueEvent.ITERATION_COMPLETED

    node_id: str
    node_type: NodeType
    
    node_run_index: int
    outputs: dict

class QueueTextChunkEvent(AppQueueEvent):
    """
    QueueTextChunkEvent entity
    """
    event = QueueEvent.TEXT_CHUNK
    text: str
    metadata: Optional[dict] = None


class QueueAgentMessageEvent(AppQueueEvent):
    """
    QueueMessageEvent entity
    """
    event = QueueEvent.AGENT_MESSAGE
    chunk: LLMResultChunk

    
class QueueMessageReplaceEvent(AppQueueEvent):
    """
    QueueMessageReplaceEvent entity
    """
    event = QueueEvent.MESSAGE_REPLACE
    text: str


class QueueRetrieverResourcesEvent(AppQueueEvent):
    """
    QueueRetrieverResourcesEvent entity
    """
    event = QueueEvent.RETRIEVER_RESOURCES
    retriever_resources: list[dict]


class QueueAnnotationReplyEvent(AppQueueEvent):
    """
    QueueAnnotationReplyEvent entity
    """
    event = QueueEvent.ANNOTATION_REPLY
    message_annotation_id: str


class QueueMessageEndEvent(AppQueueEvent):
    """
    QueueMessageEndEvent entity
    """
    event = QueueEvent.MESSAGE_END
    llm_result: Optional[LLMResult] = None


class QueueAdvancedChatMessageEndEvent(AppQueueEvent):
    """
    QueueAdvancedChatMessageEndEvent entity
    """
    event = QueueEvent.ADVANCED_CHAT_MESSAGE_END


class QueueWorkflowStartedEvent(AppQueueEvent):
    """
    QueueWorkflowStartedEvent entity
    """
    event = QueueEvent.WORKFLOW_STARTED


class QueueWorkflowSucceededEvent(AppQueueEvent):
    """
    QueueWorkflowSucceededEvent entity
    """
    event = QueueEvent.WORKFLOW_SUCCEEDED


class QueueWorkflowFailedEvent(AppQueueEvent):
    """
    QueueWorkflowFailedEvent entity
    """
    event = QueueEvent.WORKFLOW_FAILED
    error: str


class QueueNodeStartedEvent(AppQueueEvent):
    """
    QueueNodeStartedEvent entity
    """
    event = QueueEvent.NODE_STARTED

    node_id: str
    node_type: NodeType
    node_data: BaseNodeData
    node_run_index: int = 1
    predecessor_node_id: Optional[str] = None


class QueueNodeSucceededEvent(AppQueueEvent):
    """
    QueueNodeSucceededEvent entity
    """
    event = QueueEvent.NODE_SUCCEEDED

    node_id: str
    node_type: NodeType
    node_data: BaseNodeData

    inputs: Optional[dict] = None
    process_data: Optional[dict] = None
    outputs: Optional[dict] = None
    execution_metadata: Optional[dict] = None

    error: Optional[str] = None


class QueueNodeFailedEvent(AppQueueEvent):
    """
    QueueNodeFailedEvent entity
    """
    event = QueueEvent.NODE_FAILED

    node_id: str
    node_type: NodeType
    node_data: BaseNodeData

    inputs: Optional[dict] = None
    outputs: Optional[dict] = None
    process_data: Optional[dict] = None

    error: str


class QueueAgentThoughtEvent(AppQueueEvent):
    """
    QueueAgentThoughtEvent entity
    """
    event = QueueEvent.AGENT_THOUGHT
    agent_thought_id: str


class QueueMessageFileEvent(AppQueueEvent):
    """
    QueueAgentThoughtEvent entity
    """
    event = QueueEvent.MESSAGE_FILE
    message_file_id: str


class QueueErrorEvent(AppQueueEvent):
    """
    QueueErrorEvent entity
    """
    event = QueueEvent.ERROR
    error: Any


class QueuePingEvent(AppQueueEvent):
    """
    QueuePingEvent entity
    """
    event = QueueEvent.PING


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

    event = QueueEvent.STOP
    stopped_by: StopBy


class QueueMessage(BaseModel):
    """
    QueueMessage entity
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
