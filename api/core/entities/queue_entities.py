from enum import Enum
from typing import Any

from pydantic import BaseModel

from core.model_runtime.entities.llm_entities import LLMResult, LLMResultChunk


class QueueEvent(Enum):
    """
    QueueEvent enum
    """
    MESSAGE = "message"
    AGENT_MESSAGE = "agent_message"
    MESSAGE_REPLACE = "message-replace"
    MESSAGE_END = "message-end"
    RETRIEVER_RESOURCES = "retriever-resources"
    ANNOTATION_REPLY = "annotation-reply"
    AGENT_THOUGHT = "agent-thought"
    MESSAGE_FILE = "message-file"
    ERROR = "error"
    PING = "ping"
    STOP = "stop"


class AppQueueEvent(BaseModel):
    """
    QueueEvent entity
    """
    event: QueueEvent


class QueueMessageEvent(AppQueueEvent):
    """
    QueueMessageEvent entity
    """
    event = QueueEvent.MESSAGE
    chunk: LLMResultChunk

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


class AnnotationReplyEvent(AppQueueEvent):
    """
    AnnotationReplyEvent entity
    """
    event = QueueEvent.ANNOTATION_REPLY
    message_annotation_id: str


class QueueMessageEndEvent(AppQueueEvent):
    """
    QueueMessageEndEvent entity
    """
    event = QueueEvent.MESSAGE_END
    llm_result: LLMResult

    
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
