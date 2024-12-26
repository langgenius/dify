from collections.abc import Mapping, Sequence
from typing import Any, Optional, TextIO, Union

from pydantic import BaseModel

from configs import dify_config
from core.ops.entities.trace_entity import TraceTaskName
from core.ops.ops_trace_manager import TraceQueueManager, TraceTask
from core.tools.entities.tool_entities import ToolInvokeMessage

_TEXT_COLOR_MAPPING = {
    "blue": "36;1",
    "yellow": "33;1",
    "pink": "38;5;200",
    "green": "32;1",
    "red": "31;1",
}


def get_colored_text(text: str, color: str) -> str:
    """Get colored text."""
    color_str = _TEXT_COLOR_MAPPING[color]
    return f"\u001b[{color_str}m\033[1;3m{text}\u001b[0m"


def print_text(text: str, color: Optional[str] = None, end: str = "", file: Optional[TextIO] = None) -> None:
    """Print text with highlighting and no end characters."""
    text_to_print = get_colored_text(text, color) if color else text
    print(text_to_print, end=end, file=file)
    if file:
        file.flush()  # ensure all printed content are written to file


class DifyAgentCallbackHandler(BaseModel):
    """Callback Handler that prints to std out."""

    color: Optional[str] = ""
    current_loop: int = 1

    def __init__(self, color: Optional[str] = None) -> None:
        super().__init__()
        """Initialize callback handler."""
        # use a specific color is not specified
        self.color = color or "green"
        self.current_loop = 1

    def on_tool_start(
        self,
        tool_name: str,
        tool_inputs: Mapping[str, Any],
    ) -> None:
        """Do nothing."""
        if dify_config.DEBUG:
            print_text("\n[on_tool_start] ToolCall:" + tool_name + "\n" + str(tool_inputs) + "\n", color=self.color)

    def on_tool_end(
        self,
        tool_name: str,
        tool_inputs: Mapping[str, Any],
        tool_outputs: Sequence[ToolInvokeMessage] | str,
        message_id: Optional[str] = None,
        timer: Optional[Any] = None,
        trace_manager: Optional[TraceQueueManager] = None,
    ) -> None:
        """If not the final action, print out observation."""
        if dify_config.DEBUG:
            print_text("\n[on_tool_end]\n", color=self.color)
            print_text("Tool: " + tool_name + "\n", color=self.color)
            print_text("Inputs: " + str(tool_inputs) + "\n", color=self.color)
            print_text("Outputs: " + str(tool_outputs)[:1000] + "\n", color=self.color)
            print_text("\n")

        if trace_manager:
            trace_manager.add_trace_task(
                TraceTask(
                    TraceTaskName.TOOL_TRACE,
                    message_id=message_id,
                    tool_name=tool_name,
                    tool_inputs=tool_inputs,
                    tool_outputs=tool_outputs,
                    timer=timer,
                )
            )

    def on_tool_error(self, error: Union[Exception, KeyboardInterrupt], **kwargs: Any) -> None:
        """Do nothing."""
        if dify_config.DEBUG:
            print_text("\n[on_tool_error] Error: " + str(error) + "\n", color="red")

    def on_agent_start(self, thought: str) -> None:
        """Run on agent start."""
        if dify_config.DEBUG:
            if thought:
                print_text(
                    "\n[on_agent_start] \nCurrent Loop: " + str(self.current_loop) + "\nThought: " + thought + "\n",
                    color=self.color,
                )
            else:
                print_text("\n[on_agent_start] \nCurrent Loop: " + str(self.current_loop) + "\n", color=self.color)

    def on_agent_finish(self, color: Optional[str] = None, **kwargs: Any) -> None:
        """Run on agent end."""
        if dify_config.DEBUG:
            print_text("\n[on_agent_finish]\n Loop: " + str(self.current_loop) + "\n", color=self.color)

        self.current_loop += 1

    @property
    def ignore_agent(self) -> bool:
        """Whether to ignore agent callbacks."""
        return not dify_config.DEBUG

    @property
    def ignore_chat_model(self) -> bool:
        """Whether to ignore chat model callbacks."""
        return not dify_config.DEBUG
