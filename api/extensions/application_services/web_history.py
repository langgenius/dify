"""Application-owned history hooks consumed by legacy execution callers."""

from services.conversation_file_access import bind_conversation_file_scope
from services.web_message_task_control import index_web_message_task

__all__ = ["bind_conversation_file_scope", "index_web_message_task"]
