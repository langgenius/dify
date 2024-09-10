from core.app.entities.queue_entities import QueueEvent
from core.app.entities.task_entities import StreamEvent

queue_task_map = {
    StreamEvent.ERROR: QueueEvent.ERROR,
    StreamEvent.MESSAGE: QueueEvent.TEXT_CHUNK,
    StreamEvent.TTS_MESSAGE: QueueEvent.TEXT_CHUNK,
    StreamEvent.TTS_MESSAGE_END: QueueEvent.MESSAGE_END,
    StreamEvent.MESSAGE_END: QueueEvent.MESSAGE_END,
    StreamEvent.MESSAGE_FILE: QueueEvent.MESSAGE_FILE,
    StreamEvent.MESSAGE_REPLACE: QueueEvent.MESSAGE_REPLACE,
    StreamEvent.AGENT_THOUGHT: QueueEvent.AGENT_THOUGHT,
    StreamEvent.AGENT_MESSAGE: QueueEvent.AGENT_MESSAGE,
    StreamEvent.WORKFLOW_STARTED: QueueEvent.WORKFLOW_STARTED,
    StreamEvent.WORKFLOW_FINISHED: QueueEvent.WORKFLOW_SUCCEEDED,
    StreamEvent.NODE_STARTED: QueueEvent.NODE_STARTED,
    StreamEvent.NODE_FINISHED: QueueEvent.NODE_SUCCEEDED,
    StreamEvent.ITERATION_STARTED: QueueEvent.ITERATION_START,
    StreamEvent.ITERATION_NEXT: QueueEvent.ITERATION_NEXT,
    StreamEvent.ITERATION_COMPLETED: QueueEvent.ITERATION_COMPLETED,
    StreamEvent.TEXT_CHUNK: QueueEvent.TEXT_CHUNK,
    StreamEvent.TEXT_REPLACE: QueueEvent.MESSAGE_REPLACE,
    StreamEvent.PING: QueueEvent.PING,
}
