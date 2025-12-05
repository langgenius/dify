from collections.abc import Generator, Iterable, Mapping
from typing import TYPE_CHECKING, Any, Union

from core.callback_handler.agent_tool_callback_handler import DifyAgentCallbackHandler, print_text
from core.tools.entities.tool_entities import ToolInvokeMessage

if TYPE_CHECKING:
    from core.workflow.runtime.graph_runtime_state import TraceQueueManagerProtocol


class DifyWorkflowCallbackHandler(DifyAgentCallbackHandler):
    """Callback Handler that prints to std out."""

    def on_tool_execution(
        self,
        tool_name: str,
        tool_inputs: Mapping[str, Any],
        tool_outputs: Iterable[ToolInvokeMessage],
        message_id: str | None = None,
        timer: Any | None = None,
        trace_manager: Union["TraceQueueManagerProtocol", None] = None,
    ) -> Generator[ToolInvokeMessage, None, None]:
        # Convert tool_outputs to list for processing
        tool_outputs_list = list(tool_outputs)

        # Record trace for workflow tool execution
        if trace_manager:
            from core.ops.entities.trace_entity import TraceTaskName
            from core.ops.ops_trace_manager import TraceTask

            trace_manager.add_trace_task(
                TraceTask(
                    TraceTaskName.TOOL_TRACE,
                    message_id=message_id,
                    tool_name=tool_name,
                    tool_inputs=tool_inputs,
                    tool_outputs=tool_outputs_list,
                    timer=timer,
                )
            )

        for tool_output in tool_outputs_list:
            print_text("\n[on_tool_execution]\n", color=self.color)
            print_text("Tool: " + tool_name + "\n", color=self.color)
            print_text("Outputs: " + tool_output.model_dump_json()[:1000] + "\n", color=self.color)
            print_text("\n")
            yield tool_output
