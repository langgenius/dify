from collections.abc import Generator, Iterable, Mapping
from typing import Any

from core.callback_handler.agent_tool_callback_handler import DifyAgentCallbackHandler, print_text
from core.ops.ops_trace_manager import TraceQueueManager
from core.tools.entities.tool_entities import ToolInvokeMessage


class DifyWorkflowCallbackHandler(DifyAgentCallbackHandler):
    """Callback Handler that prints to std out."""

    def on_tool_execution(
        self,
        tool_name: str,
        tool_inputs: Mapping[str, Any],
        tool_outputs: Iterable[ToolInvokeMessage],
        message_id: str | None = None,
        timer: Any | None = None,
        trace_manager: TraceQueueManager | None = None,
    ) -> Generator[ToolInvokeMessage, None, None]:
        for tool_output in tool_outputs:
            print_text("\n[on_tool_execution]\n", color=self.color)
            print_text("Tool: " + tool_name + "\n", color=self.color)
            print_text("Outputs: " + tool_output.model_dump_json()[:1000] + "\n", color=self.color)
            print_text("\n")
            yield tool_output
