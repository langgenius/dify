"""Text-generation result interpretation; delete with the completion application."""

from collections.abc import Mapping
from typing import Any

from core.ops.message_trace import MessageTraceRecorder


def record_completion_result(message_trace: MessageTraceRecorder, message_fields: Mapping[str, Any]) -> None:
    message_trace.finish_message_trace(message_fields, span_name="Completion", include_llm=True)
