import os
from typing import Any, Optional, Union

from langchain.callbacks.base import BaseCallbackHandler
from langchain.input import print_text
from pydantic import BaseModel


class DifyAgentCallbackHandler(BaseCallbackHandler, BaseModel):
    """Callback Handler that prints to std out."""
    color: Optional[str] = ''
    current_loop = 1

    def __init__(self, color: Optional[str] = None) -> None:
        super().__init__()
        """Initialize callback handler."""
        # use a specific color is not specified
        self.color = color or 'green'
        self.current_loop = 1

    def on_tool_start(
        self,
        tool_name: str,
        tool_inputs: dict[str, Any],
    ) -> None:
        """Do nothing."""
        print_text("\n[on_tool_start] ToolCall:" + tool_name + "\n" + str(tool_inputs) + "\n", color=self.color)

    def on_tool_end(
        self,
        tool_name: str,
        tool_inputs: dict[str, Any],
        tool_outputs: str,
    ) -> None:
        """If not the final action, print out observation."""
        print_text("\n[on_tool_end]\n", color=self.color)
        print_text("Tool: " + tool_name + "\n", color=self.color)
        print_text("Inputs: " + str(tool_inputs) + "\n", color=self.color)
        print_text("Outputs: " + str(tool_outputs) + "\n", color=self.color)
        print_text("\n")

    def on_tool_error(
        self, error: Union[Exception, KeyboardInterrupt], **kwargs: Any
    ) -> None:
        """Do nothing."""
        print_text("\n[on_tool_error] Error: " + str(error) + "\n", color='red')

    def on_agent_start(
        self, thought: str
    ) -> None:
        """Run on agent start."""
        if thought:
            print_text("\n[on_agent_start] \nCurrent Loop: " + \
                        str(self.current_loop) + \
                        "\nThought: " + thought + "\n", color=self.color)
        else:
            print_text("\n[on_agent_start] \nCurrent Loop: " + str(self.current_loop) + "\n", color=self.color)

    def on_agent_finish(
        self, color: Optional[str] = None, **kwargs: Any
    ) -> None:
        """Run on agent end."""
        print_text("\n[on_agent_finish]\n Loop: " + str(self.current_loop) + "\n", color=self.color)

        self.current_loop += 1

    @property
    def ignore_agent(self) -> bool:
        """Whether to ignore agent callbacks."""
        return not os.environ.get("DEBUG") or os.environ.get("DEBUG").lower() != 'true'

    @property
    def ignore_chat_model(self) -> bool:
        """Whether to ignore chat model callbacks."""
        return not os.environ.get("DEBUG") or os.environ.get("DEBUG").lower() != 'true'
