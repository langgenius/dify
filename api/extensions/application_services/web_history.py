"""Application-owned Web execution hooks consumed by legacy callers."""

from services.conversation_file_access import bind_conversation_file_scope
from services.web_message_task_control import index_web_message_task
from services.web_workflow_admission import web_workflow_launch, web_workflow_worker

__all__ = ["bind_conversation_file_scope", "index_web_message_task", "web_workflow_launch", "web_workflow_worker"]
