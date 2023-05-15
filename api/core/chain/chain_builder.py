from typing import Optional

from langchain.callbacks import CallbackManager

from core.callback_handler.std_out_callback_handler import DifyStdOutCallbackHandler
from core.chain.sensitive_word_avoidance_chain import SensitiveWordAvoidanceChain
from core.chain.tool_chain import ToolChain


class ChainBuilder:
    @classmethod
    def to_tool_chain(cls, tool, **kwargs) -> ToolChain:
        return ToolChain(
            tool=tool,
            input_key=kwargs.get('input_key', 'input'),
            output_key=kwargs.get('output_key', 'tool_output'),
            callback_manager=CallbackManager([DifyStdOutCallbackHandler()])
        )

    @classmethod
    def to_sensitive_word_avoidance_chain(cls, tool_config: dict, **kwargs) -> Optional[
        SensitiveWordAvoidanceChain]:
        sensitive_words = tool_config.get("words", "")
        if tool_config.get("enabled", False) \
                and sensitive_words:
            return SensitiveWordAvoidanceChain(
                sensitive_words=sensitive_words.split(","),
                canned_response=tool_config.get("canned_response", ''),
                output_key="sensitive_word_avoidance_output",
                callback_manager=CallbackManager([DifyStdOutCallbackHandler()]),
                **kwargs
            )

        return None
