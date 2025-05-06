from core.app.entities.queue_entities import AppQueueEvent, QueueEvent
from core.app.entities.task_entities import StreamEvent, StreamResponse

workflow_queue_task_map = {
    StreamEvent.PING: QueueEvent.PING,
    StreamEvent.ERROR: QueueEvent.ERROR,
    StreamEvent.MESSAGE: QueueEvent.TEXT_CHUNK,
    StreamEvent.MESSAGE_END: QueueEvent.MESSAGE_END,
    StreamEvent.TTS_MESSAGE: QueueEvent.TEXT_CHUNK,
    StreamEvent.TTS_MESSAGE_END: QueueEvent.MESSAGE_END,
    StreamEvent.MESSAGE_FILE: QueueEvent.MESSAGE_FILE,
    StreamEvent.MESSAGE_REPLACE: QueueEvent.MESSAGE_REPLACE,
    StreamEvent.AGENT_THOUGHT: QueueEvent.AGENT_THOUGHT,
    StreamEvent.AGENT_MESSAGE: QueueEvent.AGENT_MESSAGE,
    StreamEvent.WORKFLOW_STARTED: QueueEvent.WORKFLOW_STARTED,
    StreamEvent.WORKFLOW_FINISHED: QueueEvent.WORKFLOW_SUCCEEDED,
    StreamEvent.NODE_STARTED: QueueEvent.NODE_STARTED,
    StreamEvent.NODE_FINISHED: QueueEvent.NODE_SUCCEEDED,
    StreamEvent.NODE_RETRY: QueueEvent.RETRY,
    StreamEvent.PARALLEL_BRANCH_STARTED: QueueEvent.PARALLEL_BRANCH_RUN_STARTED,
    StreamEvent.PARALLEL_BRANCH_FINISHED: QueueEvent.PARALLEL_BRANCH_RUN_SUCCEEDED,
    StreamEvent.ITERATION_STARTED: QueueEvent.ITERATION_START,
    StreamEvent.ITERATION_NEXT: QueueEvent.ITERATION_NEXT,
    StreamEvent.ITERATION_COMPLETED: QueueEvent.ITERATION_COMPLETED,
    StreamEvent.LOOP_STARTED: QueueEvent.LOOP_START,
    StreamEvent.LOOP_NEXT: QueueEvent.LOOP_NEXT,
    StreamEvent.LOOP_COMPLETED: QueueEvent.LOOP_COMPLETED,
    StreamEvent.TEXT_CHUNK: QueueEvent.TEXT_CHUNK,
    StreamEvent.TEXT_REPLACE: QueueEvent.MESSAGE_REPLACE,
    StreamEvent.AGENT_LOG: QueueEvent.AGENT_LOG,
}

advance_chat_queue_task_map = {
    StreamEvent.PING: QueueEvent.PING,
    StreamEvent.ERROR: QueueEvent.ERROR,
    StreamEvent.MESSAGE: QueueEvent.TEXT_CHUNK,
    StreamEvent.MESSAGE_END: QueueEvent.ADVANCED_CHAT_MESSAGE_END,
    StreamEvent.TTS_MESSAGE: QueueEvent.TEXT_CHUNK,
    StreamEvent.TTS_MESSAGE_END: QueueEvent.MESSAGE_END,
    StreamEvent.MESSAGE_FILE: QueueEvent.MESSAGE_FILE,
    StreamEvent.MESSAGE_REPLACE: QueueEvent.MESSAGE_REPLACE,
    StreamEvent.AGENT_THOUGHT: QueueEvent.AGENT_THOUGHT,
    StreamEvent.AGENT_MESSAGE: QueueEvent.AGENT_MESSAGE,
    StreamEvent.WORKFLOW_STARTED: QueueEvent.WORKFLOW_STARTED,
    StreamEvent.WORKFLOW_FINISHED: QueueEvent.WORKFLOW_SUCCEEDED,
    StreamEvent.NODE_STARTED: QueueEvent.NODE_STARTED,
    StreamEvent.NODE_FINISHED: QueueEvent.NODE_SUCCEEDED,
    StreamEvent.NODE_RETRY: QueueEvent.RETRY,
    StreamEvent.PARALLEL_BRANCH_STARTED: QueueEvent.PARALLEL_BRANCH_RUN_STARTED,
    StreamEvent.PARALLEL_BRANCH_FINISHED: QueueEvent.PARALLEL_BRANCH_RUN_SUCCEEDED,
    StreamEvent.ITERATION_STARTED: QueueEvent.ITERATION_START,
    StreamEvent.ITERATION_NEXT: QueueEvent.ITERATION_NEXT,
    StreamEvent.ITERATION_COMPLETED: QueueEvent.ITERATION_COMPLETED,
    StreamEvent.LOOP_STARTED: QueueEvent.LOOP_START,
    StreamEvent.LOOP_NEXT: QueueEvent.LOOP_NEXT,
    StreamEvent.LOOP_COMPLETED: QueueEvent.LOOP_COMPLETED,
    StreamEvent.TEXT_CHUNK: QueueEvent.TEXT_CHUNK,
    StreamEvent.TEXT_REPLACE: QueueEvent.MESSAGE_REPLACE,
    StreamEvent.AGENT_LOG: QueueEvent.AGENT_LOG,
}


class ForwardQueueMessage(AppQueueEvent):
    """
    ForwardQueueMessage entity
    """

    event: QueueEvent = QueueEvent.PING
    response: StreamResponse
