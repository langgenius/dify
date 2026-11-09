import json
import logging
import sys
from collections.abc import Mapping, Sequence
from typing import override

from graphon.model_runtime.callbacks.base_callback import Callback
from graphon.model_runtime.entities.llm_entities import LLMResult, LLMResultChunk
from graphon.model_runtime.entities.message_entities import (
    PromptMessage,
    PromptMessageTool,
)
from graphon.model_runtime.model_providers.base.ai_model import AIModel

logger = logging.getLogger(__name__)


class LoggingCallback(Callback):
    @override
    def on_before_invoke(
        self,
        llm_instance: AIModel,
        model: str,
        credentials: dict,
        prompt_messages: list[PromptMessage],
        model_parameters: dict,
        tools: list[PromptMessageTool] | None = None,
        stop: Sequence[str] | None = None,
        stream: bool = True,
        user: str | None = None,
        request_metadata: Mapping[str, object] | None = None,
    ) -> None:
        """Before invoke callback

        :param llm_instance: LLM instance
        :param model: model name
        :param credentials: model credentials
        :param prompt_messages: prompt messages
        :param model_parameters: model parameters
        :param tools: tools for tool calling
        :param stop: stop words
        :param stream: is stream response
        :param user: optional end-user identifier for the invocation
        :param request_metadata: opaque metadata for the current request
        """
        self.print_text("\n[on_llm_before_invoke]\n", color="blue")
        self.print_text(f"Model: {model}\n", color="blue")
        self.print_text("Parameters:\n", color="blue")
        for key, value in model_parameters.items():
            self.print_text(f"\t{key}: {value}\n", color="blue")

        if stop:
            self.print_text(f"\tstop: {stop}\n", color="blue")

        if tools:
            self.print_text("\tTools:\n", color="blue")
            for tool in tools:
                self.print_text(f"\t\t{tool.name}\n", color="blue")

        self.print_text(f"Stream: {stream}\n", color="blue")
        if user:
            self.print_text(f"User: {user}\n", color="blue")

        if request_metadata:
            self.print_text(
                f"Request metadata: {dict(request_metadata)}\n",
                color="blue",
            )

        self.print_text("Prompt messages:\n", color="blue")
        for prompt_message in prompt_messages:
            if prompt_message.name:
                self.print_text(f"\tname: {prompt_message.name}\n", color="blue")

            self.print_text(f"\trole: {prompt_message.role.value}\n", color="blue")
            self.print_text(f"\tcontent: {prompt_message.content}\n", color="blue")

        if stream:
            self.print_text("\n[on_llm_new_chunk]")

    @override
    def on_new_chunk(
        self,
        llm_instance: AIModel,
        chunk: LLMResultChunk,
        model: str,
        credentials: dict,
        prompt_messages: Sequence[PromptMessage],
        model_parameters: dict,
        tools: list[PromptMessageTool] | None = None,
        stop: Sequence[str] | None = None,
        stream: bool = True,
        user: str | None = None,
        request_metadata: Mapping[str, object] | None = None,
    ) -> None:
        """On new chunk callback

        :param llm_instance: LLM instance
        :param chunk: chunk
        :param model: model name
        :param credentials: model credentials
        :param prompt_messages: prompt messages
        :param model_parameters: model parameters
        :param tools: tools for tool calling
        :param stop: stop words
        :param stream: is stream response
        :param request_metadata: opaque metadata for the current request
        """
        _ = user, request_metadata
        if isinstance(chunk.delta.message.content, str):
            sys.stdout.write(chunk.delta.message.content)
            sys.stdout.flush()

    @override
    def on_after_invoke(
        self,
        llm_instance: AIModel,
        result: LLMResult,
        model: str,
        credentials: dict,
        prompt_messages: Sequence[PromptMessage],
        model_parameters: dict,
        tools: list[PromptMessageTool] | None = None,
        stop: Sequence[str] | None = None,
        stream: bool = True,
        user: str | None = None,
        request_metadata: Mapping[str, object] | None = None,
    ) -> None:
        """After invoke callback

        :param llm_instance: LLM instance
        :param result: result
        :param model: model name
        :param credentials: model credentials
        :param prompt_messages: prompt messages
        :param model_parameters: model parameters
        :param tools: tools for tool calling
        :param stop: stop words
        :param stream: is stream response
        :param request_metadata: opaque metadata for the current request
        """
        _ = user, request_metadata
        self.print_text("\n[on_llm_after_invoke]\n", color="yellow")
        self.print_text(f"Content: {result.message.content}\n", color="yellow")

        if result.message.tool_calls:
            self.print_text("Tool calls:\n", color="yellow")
            for tool_call in result.message.tool_calls:
                self.print_text(f"\t{tool_call.id}\n", color="yellow")
                self.print_text(f"\t{tool_call.function.name}\n", color="yellow")
                self.print_text(
                    f"\t{json.dumps(tool_call.function.arguments)}\n",
                    color="yellow",
                )

        self.print_text(f"Model: {result.model}\n", color="yellow")
        self.print_text(f"Usage: {result.usage}\n", color="yellow")
        self.print_text(
            f"System Fingerprint: {result.system_fingerprint}\n",
            color="yellow",
        )

    @override
    def on_invoke_error(
        self,
        llm_instance: AIModel,
        ex: Exception,
        model: str,
        credentials: dict,
        prompt_messages: list[PromptMessage],
        model_parameters: dict,
        tools: list[PromptMessageTool] | None = None,
        stop: Sequence[str] | None = None,
        stream: bool = True,
        user: str | None = None,
        request_metadata: Mapping[str, object] | None = None,
    ) -> None:
        """Invoke error callback

        :param llm_instance: LLM instance
        :param ex: exception
        :param model: model name
        :param credentials: model credentials
        :param prompt_messages: prompt messages
        :param model_parameters: model parameters
        :param tools: tools for tool calling
        :param stop: stop words
        :param stream: is stream response
        :param request_metadata: opaque metadata for the current request
        """
        _ = user, request_metadata
        self.print_text("\n[on_llm_invoke_error]\n", color="red")
        logger.error("LLM invoke failed: %s", ex, exc_info=ex)
