import queue
import threading
from enum import Enum

from extensions.ext_database import db
from models.model import Conversation, MessageFile
from services.ops_trace.utils import get_message_data


class TraceTaskName(str, Enum):
    CONVERSATION_TRACE = 'conversation_trace'
    WORKFLOW_TRACE = 'workflow_trace'
    MESSAGE_TRACE = 'message_trace'
    MODERATION_TRACE = 'moderation_trace'
    SUGGESTED_QUESTION_TRACE = 'suggested_question_trace'
    DATASET_RETRIEVAL_TRACE = 'dataset_retrieval_trace'
    TOOL_TRACE = 'tool_trace'
    GENERATE_NAME_TRACE = 'generate_name_trace'


class TraceTask:
    def __init__(self, trace_instance, trace_type, **kwargs):
        self.trace_instance = trace_instance
        self.trace_type = trace_type
        self.kwargs = kwargs

    def execute(self):
        method_name, processed_kwargs = self.preprocess()
        method = getattr(self.trace_instance, method_name)
        method(**processed_kwargs)

    def preprocess(self):
        if self.trace_type == TraceTaskName.CONVERSATION_TRACE:
            return TraceTaskName.CONVERSATION_TRACE, self.process_conversation_trace(**self.kwargs)
        if self.trace_type == TraceTaskName.WORKFLOW_TRACE:
            return TraceTaskName.WORKFLOW_TRACE, self.process_workflow_trace(**self.kwargs)
        elif self.trace_type == TraceTaskName.MESSAGE_TRACE:
            return TraceTaskName.MESSAGE_TRACE, self.process_message_trace(**self.kwargs)
        elif self.trace_type == TraceTaskName.MODERATION_TRACE:
            return TraceTaskName.MODERATION_TRACE, self.process_moderation_trace(**self.kwargs)
        elif self.trace_type == TraceTaskName.SUGGESTED_QUESTION_TRACE:
            return TraceTaskName.SUGGESTED_QUESTION_TRACE, self.process_suggested_question_trace(**self.kwargs)
        elif self.trace_type == TraceTaskName.DATASET_RETRIEVAL_TRACE:
            return TraceTaskName.DATASET_RETRIEVAL_TRACE, self.process_dataset_retrieval_trace(**self.kwargs)
        elif self.trace_type == TraceTaskName.TOOL_TRACE:
            return TraceTaskName.TOOL_TRACE, self.process_tool_trace(**self.kwargs)
        elif self.trace_type == TraceTaskName.GENERATE_NAME_TRACE:
            return TraceTaskName.GENERATE_NAME_TRACE, self.process_generate_name_trace(**self.kwargs)
        else:
            return '', {}

    # process methods for different trace types
    def process_conversation_trace(self, **kwargs):
        return kwargs

    def process_workflow_trace(self, **kwargs):
        return kwargs

    def process_message_trace(self, **kwargs):
        message_id = kwargs.get('message_id')
        message_data = get_message_data(message_id)
        if not message_data:
            return {}
        message_file_data = db.session.query(MessageFile).filter_by(message_id=message_id).first()
        conversation_mode = db.session.query(Conversation.mode).filter_by(id=message_data.conversation_id).first()
        conversation_mode = conversation_mode[0]
        kwargs['message_data'] = message_data
        kwargs['message_file_data'] = message_file_data
        kwargs['conversation_mode'] = conversation_mode
        return kwargs

    def process_moderation_trace(self, **kwargs):
        message_id = kwargs.get('message_id')
        message_data = get_message_data(message_id)
        if not message_data:
            return {}
        kwargs['message_data'] = message_data
        return kwargs

    def process_suggested_question_trace(self, **kwargs):
        message_id = kwargs.get('message_id')
        message_data = get_message_data(message_id)
        if not message_data:
            return {}
        kwargs['message_data'] = message_data
        return kwargs

    def process_dataset_retrieval_trace(self, **kwargs):
        message_id = kwargs.get('message_id')
        message_data = get_message_data(message_id)
        if not message_data:
            return {}
        kwargs['message_data'] = message_data
        return kwargs

    def process_tool_trace(self, **kwargs):
        message_id = kwargs.get('message_id')
        message_data = get_message_data(message_id)
        if not message_data:
            return {}
        message_file_data = db.session.query(MessageFile).filter_by(message_id=message_id).first()
        kwargs['message_data'] = message_data
        kwargs['message_file_data'] = message_file_data
        return kwargs

    def process_generate_name_trace(self, **kwargs):
        return kwargs


class TraceQueueManager:
    def __init__(self):
        from app import app
        self.app = app
        self.queue = queue.Queue()
        self.is_running = True
        self.thread = threading.Thread(target=self.process_queue)
        self.thread.start()

    def stop(self):
        self.is_running = False

    def process_queue(self):
        with self.app.app_context():
            while self.is_running:
                try:
                    task = self.queue.get(timeout=1)
                    task.execute()
                    self.queue.task_done()
                except queue.Empty:
                    self.stop()

    def add_trace_task(self, trace_task):
        self.queue.put(trace_task)
