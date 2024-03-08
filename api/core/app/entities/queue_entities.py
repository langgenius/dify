from enum import Enum
from typing import Any

from pydantic import BaseModel

from core.model_runtime.entities.llm_entities import LLMResult, LLMResultChunk


class QueueEvent(Enum):
    """
    QueueEvent enum
    """
    LLM_CHUNK = "llm_chunk"
    TEXT_CHUNK = "text_chunk"
    AGENT_MESSAGE = "agent_message"
    MESSAGE_REPLACE = "message_replace"
    MESSAGE_END = "message_end"
    WORKFLOW_STARTED = "workflow_started"
    WORKFLOW_FINISHED = "workflow_finished"
    NODE_STARTED = "node_started"
    NODE_FINISHED = "node_finished"
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


class QueueTextChunkEvent(AppQueueEvent):
    """
    QueueTextChunkEvent entity
    """
    event = QueueEvent.TEXT_CHUNK
    text: str


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
    llm_result: LLMResult


class QueueWorkflowStartedEvent(AppQueueEvent):
    """
    QueueWorkflowStartedEvent entity
    """
    event = QueueEvent.WORKFLOW_STARTED
    workflow_run_id: str


class QueueWorkflowFinishedEvent(AppQueueEvent):
    """
    QueueWorkflowFinishedEvent entity
    """
    event = QueueEvent.WORKFLOW_FINISHED
    workflow_run_id: str


class QueueNodeStartedEvent(AppQueueEvent):
    """
    QueueNodeStartedEvent entity
    """
    event = QueueEvent.NODE_STARTED
    workflow_node_execution_id: str


class QueueNodeFinishedEvent(AppQueueEvent):
    """
    QueueNodeFinishedEvent entity
    """
    event = QueueEvent.NODE_FINISHED
    workflow_node_execution_id: str

    
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
    message_id: str
    conversation_id: str
    app_mode: str
    event: AppQueueEvent
