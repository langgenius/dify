from enum import Enum

from pydantic import BaseModel

from core.model_runtime.entities.llm_entities import LLMResult, LLMResultChunk


class QueueEvent(Enum):
    """
    QueueEvent enum
    """
    MESSAGE = "message"
    MESSAGE_REPLACE = "message-replace"
    MESSAGE_END = "message-end"
    RETRIEVER_RESOURCES = "retriever-resources"
    AGENT_THOUGHT = "agent-thought"
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
    
    
class QueueErrorEvent(AppQueueEvent):
    """
    QueueErrorEvent entity
    """
    event = QueueEvent.ERROR
    error: Exception


class QueuePingEvent(AppQueueEvent):
    """
    QueuePingEvent entity
    """
    event = QueueEvent.PING


class QueueStopEvent(AppQueueEvent):
    """
    QueueStopEvent entity
    """
    event = QueueEvent.STOP


class QueueMessage(BaseModel):
    """
    QueueMessage entity
    """
    task_id: str
    message_id: str
    conversation_id: str
    app_mode: str
    event: AppQueueEvent
