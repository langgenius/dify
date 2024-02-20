import os
import sys
from typing import Any, Optional, Union

from langchain.callbacks.base import BaseCallbackHandler
from langchain.input import print_text
from langchain.schema import AgentAction, AgentFinish, BaseMessage, LLMResult


class DifyStdOutCallbackHandler(BaseCallbackHandler):
    """Callback Handler that prints to std out."""

    def __init__(self, color: Optional[str] = None) -> None:
        """Initialize callback handler."""
        self.color = color

    def on_chat_model_start(
            self,
            serialized: dict[str, Any],
            messages: list[list[BaseMessage]],
            **kwargs: Any
    ) -> Any:
        print_text("\n[on_chat_model_start]\n", color='blue')
        for sub_messages in messages:
            for sub_message in sub_messages:
                print_text(str(sub_message) + "\n", color='blue')

    def on_llm_start(
        self, serialized: dict[str, Any], prompts: list[str], **kwargs: Any
    ) -> None:
        """Print out the prompts."""
        print_text("\n[on_llm_start]\n", color='blue')
        print_text(prompts[0] + "\n", color='blue')

    def on_llm_end(self, response: LLMResult, **kwargs: Any) -> None:
        """Do nothing."""
        print_text("\n[on_llm_end]\nOutput: " + str(response.generations[0][0].text) + "\nllm_output: " + str(
            response.llm_output) + "\n", color='blue')

    def on_llm_new_token(self, token: str, **kwargs: Any) -> None:
        """Do nothing."""
        pass

    def on_llm_error(
        self, error: Union[Exception, KeyboardInterrupt], **kwargs: Any
    ) -> None:
        """Do nothing."""
        print_text("\n[on_llm_error]\nError: " + str(error) + "\n", color='blue')

    def on_chain_start(
        self, serialized: dict[str, Any], inputs: dict[str, Any], **kwargs: Any
    ) -> None:
        """Print out that we are entering a chain."""
        chain_type = serialized['id'][-1]
        print_text("\n[on_chain_start]\nChain: " + chain_type + "\nInputs: " + str(inputs) + "\n", color='pink')

    def on_chain_end(self, outputs: dict[str, Any], **kwargs: Any) -> None:
        """Print out that we finished a chain."""
        print_text("\n[on_chain_end]\nOutputs: " + str(outputs) + "\n", color='pink')

    def on_chain_error(
        self, error: Union[Exception, KeyboardInterrupt], **kwargs: Any
    ) -> None:
        """Do nothing."""
        print_text("\n[on_chain_error]\nError: " + str(error) + "\n", color='pink')

    def on_tool_start(
        self,
        serialized: dict[str, Any],
        input_str: str,
        **kwargs: Any,
    ) -> None:
        """Do nothing."""
        print_text("\n[on_tool_start] " + str(serialized), color='yellow')

    def on_agent_action(
        self, action: AgentAction, color: Optional[str] = None, **kwargs: Any
    ) -> Any:
        """Run on agent action."""
        tool = action.tool
        tool_input = action.tool_input
        try:
            action_name_position = action.log.index("\nAction:") + 1 if action.log else -1
            thought = action.log[:action_name_position].strip() if action.log else ''
        except ValueError:
            thought = ''

        log = f"Thought: {thought}\nTool: {tool}\nTool Input: {tool_input}"
        print_text("\n[on_agent_action]\n" + log + "\n", color='green')

    def on_tool_end(
        self,
        output: str,
        color: Optional[str] = None,
        observation_prefix: Optional[str] = None,
        llm_prefix: Optional[str] = None,
        **kwargs: Any,
    ) -> None:
        """If not the final action, print out observation."""
        print_text("\n[on_tool_end]\n", color='yellow')
        if observation_prefix:
            print_text(f"\n{observation_prefix}")
        print_text(output, color='yellow')
        if llm_prefix:
            print_text(f"\n{llm_prefix}")
        print_text("\n")

    def on_tool_error(
        self, error: Union[Exception, KeyboardInterrupt], **kwargs: Any
    ) -> None:
        """Do nothing."""
        print_text("\n[on_tool_error] Error: " + str(error) + "\n", color='yellow')

    def on_text(
        self,
        text: str,
        color: Optional[str] = None,
        end: str = "",
        **kwargs: Optional[str],
    ) -> None:
        """Run when agent ends."""
        print_text("\n[on_text] " + text + "\n", color=color if color else self.color, end=end)

    def on_agent_finish(
        self, finish: AgentFinish, color: Optional[str] = None, **kwargs: Any
    ) -> None:
        """Run on agent end."""
        print_text("[on_agent_finish] " + finish.return_values['output'] + "\n", color='green', end="\n")

    @property
    def ignore_llm(self) -> bool:
        """Whether to ignore LLM callbacks."""
        return not os.environ.get("DEBUG") or os.environ.get("DEBUG").lower() != 'true'

    @property
    def ignore_chain(self) -> bool:
        """Whether to ignore chain callbacks."""
        return not os.environ.get("DEBUG") or os.environ.get("DEBUG").lower() != 'true'

    @property
    def ignore_agent(self) -> bool:
        """Whether to ignore agent callbacks."""
        return not os.environ.get("DEBUG") or os.environ.get("DEBUG").lower() != 'true'

    @property
    def ignore_chat_model(self) -> bool:
        """Whether to ignore chat model callbacks."""
        return not os.environ.get("DEBUG") or os.environ.get("DEBUG").lower() != 'true'


class DifyStreamingStdOutCallbackHandler(DifyStdOutCallbackHandler):
    """Callback handler for streaming. Only works with LLMs that support streaming."""

    def on_llm_new_token(self, token: str, **kwargs: Any) -> None:
        """Run on new LLM token. Only available when streaming is enabled."""
        sys.stdout.write(token)
        sys.stdout.flush()
