import logging
import time
import uuid
from collections.abc import Callable, Generator, Iterator, Sequence
from typing import Union

from pydantic import ConfigDict

from configs import dify_config
from core.model_runtime.callbacks.base_callback import Callback
from core.model_runtime.callbacks.logging_callback import LoggingCallback
from core.model_runtime.entities.llm_entities import LLMResult, LLMResultChunk, LLMUsage
from core.model_runtime.entities.message_entities import (
    AssistantPromptMessage,
    PromptMessage,
    PromptMessageContentUnionTypes,
    PromptMessageTool,
    TextPromptMessageContent,
)
from core.model_runtime.entities.model_entities import (
    ModelType,
    PriceType,
)
from core.model_runtime.model_providers.__base.ai_model import AIModel

logger = logging.getLogger(__name__)


def _gen_tool_call_id() -> str:
    return f"chatcmpl-tool-{str(uuid.uuid4().hex)}"


def _run_callbacks(callbacks: Sequence[Callback] | None, *, event: str, invoke: Callable[[Callback], None]) -> None:
    if not callbacks:
        return

    for callback in callbacks:
        try:
            invoke(callback)
        except Exception as e:
            if callback.raise_error:
                raise
            logger.warning("Callback %s %s failed with error %s", callback.__class__.__name__, event, e)


def _get_or_create_tool_call(
    existing_tools_calls: list[AssistantPromptMessage.ToolCall],
    tool_call_id: str,
) -> AssistantPromptMessage.ToolCall:
    """
    Get or create a tool call by ID.

    If `tool_call_id` is empty, returns the most recently created tool call.
    """
    if not tool_call_id:
        if not existing_tools_calls:
            raise ValueError("tool_call_id is empty but no existing tool call is available to apply the delta")
        return existing_tools_calls[-1]

    tool_call = next((tool_call for tool_call in existing_tools_calls if tool_call.id == tool_call_id), None)
    if tool_call is None:
        tool_call = AssistantPromptMessage.ToolCall(
            id=tool_call_id,
            type="function",
            function=AssistantPromptMessage.ToolCall.ToolCallFunction(name="", arguments=""),
        )
        existing_tools_calls.append(tool_call)

    return tool_call


def _merge_tool_call_delta(
    tool_call: AssistantPromptMessage.ToolCall,
    delta: AssistantPromptMessage.ToolCall,
) -> None:
    if delta.id:
        tool_call.id = delta.id
    if delta.type:
        tool_call.type = delta.type
    if delta.function.name:
        tool_call.function.name = delta.function.name
    if delta.function.arguments:
        tool_call.function.arguments += delta.function.arguments


def _build_llm_result_from_first_chunk(
    model: str,
    prompt_messages: Sequence[PromptMessage],
    chunks: Iterator[LLMResultChunk],
) -> LLMResult:
    """
    Build a single `LLMResult` from the first returned chunk.

    This is used for `stream=False` because the plugin side may still implement the response via a chunked stream.
    """
    content = ""
    content_list: list[PromptMessageContentUnionTypes] = []
    usage = LLMUsage.empty_usage()
    system_fingerprint: str | None = None
    tools_calls: list[AssistantPromptMessage.ToolCall] = []

    first_chunk = next(chunks, None)
    if first_chunk is not None:
        if isinstance(first_chunk.delta.message.content, str):
            content += first_chunk.delta.message.content
        elif isinstance(first_chunk.delta.message.content, list):
            content_list.extend(first_chunk.delta.message.content)

        if first_chunk.delta.message.tool_calls:
            _increase_tool_call(first_chunk.delta.message.tool_calls, tools_calls)

        usage = first_chunk.delta.usage or LLMUsage.empty_usage()
        system_fingerprint = first_chunk.system_fingerprint

    return LLMResult(
        model=model,
        prompt_messages=prompt_messages,
        message=AssistantPromptMessage(
            content=content or content_list,
            tool_calls=tools_calls,
        ),
        usage=usage,
        system_fingerprint=system_fingerprint,
    )


def _invoke_llm_via_plugin(
    *,
    tenant_id: str,
    user_id: str,
    plugin_id: str,
    provider: str,
    model: str,
    credentials: dict,
    model_parameters: dict,
    prompt_messages: Sequence[PromptMessage],
    tools: list[PromptMessageTool] | None,
    stop: Sequence[str] | None,
    stream: bool,
) -> Union[LLMResult, Generator[LLMResultChunk, None, None]]:
    from core.plugin.impl.model import PluginModelClient

    plugin_model_manager = PluginModelClient()
    return plugin_model_manager.invoke_llm(
        tenant_id=tenant_id,
        user_id=user_id,
        plugin_id=plugin_id,
        provider=provider,
        model=model,
        credentials=credentials,
        model_parameters=model_parameters,
        prompt_messages=list(prompt_messages),
        tools=tools,
        stop=list(stop) if stop else None,
        stream=stream,
    )


def _normalize_non_stream_plugin_result(
    model: str,
    prompt_messages: Sequence[PromptMessage],
    result: Union[LLMResult, Iterator[LLMResultChunk]],
) -> LLMResult:
    if isinstance(result, LLMResult):
        return result
    return _build_llm_result_from_first_chunk(model=model, prompt_messages=prompt_messages, chunks=result)


def _increase_tool_call(
    new_tool_calls: list[AssistantPromptMessage.ToolCall], existing_tools_calls: list[AssistantPromptMessage.ToolCall]
):
    """
    Merge incremental tool call updates into existing tool calls.

    :param new_tool_calls: List of new tool call deltas to be merged.
    :param existing_tools_calls: List of existing tool calls to be modified IN-PLACE.
    """

    for new_tool_call in new_tool_calls:
        # generate ID for tool calls with function name but no ID to track them
        if new_tool_call.function.name and not new_tool_call.id:
            new_tool_call.id = _gen_tool_call_id()

        tool_call = _get_or_create_tool_call(existing_tools_calls, new_tool_call.id)
        _merge_tool_call_delta(tool_call, new_tool_call)


class LargeLanguageModel(AIModel):
    """
    Model class for large language model.
    """

    model_type: ModelType = ModelType.LLM

    # pydantic configs
    model_config = ConfigDict(protected_namespaces=())

    def invoke(
        self,
        model: str,
        credentials: dict,
        prompt_messages: list[PromptMessage],
        model_parameters: dict | None = None,
        tools: list[PromptMessageTool] | None = None,
        stop: list[str] | None = None,
        stream: bool = True,
        user: str | None = None,
        callbacks: list[Callback] | None = None,
    ) -> Union[LLMResult, Generator[LLMResultChunk, None, None]]:
        """
        Invoke large language model

        :param model: model name
        :param credentials: model credentials
        :param prompt_messages: prompt messages
        :param model_parameters: model parameters
        :param tools: tools for tool calling
        :param stop: stop words
        :param stream: is stream response
        :param user: unique user id
        :param callbacks: callbacks
        :return: full response or stream response chunk generator result
        """
        # validate and filter model parameters
        if model_parameters is None:
            model_parameters = {}

        self.started_at = time.perf_counter()

        callbacks = callbacks or []

        if dify_config.DEBUG:
            callbacks.append(LoggingCallback())

        # trigger before invoke callbacks
        self._trigger_before_invoke_callbacks(
            model=model,
            credentials=credentials,
            prompt_messages=prompt_messages,
            model_parameters=model_parameters,
            tools=tools,
            stop=stop,
            stream=stream,
            user=user,
            callbacks=callbacks,
        )

        result: Union[LLMResult, Generator[LLMResultChunk, None, None]]

        try:
            result = _invoke_llm_via_plugin(
                tenant_id=self.tenant_id,
                user_id=user or "unknown",
                plugin_id=self.plugin_id,
                provider=self.provider_name,
                model=model,
                credentials=credentials,
                model_parameters=model_parameters,
                prompt_messages=prompt_messages,
                tools=tools,
                stop=stop,
                stream=stream,
            )

            if not stream:
                result = _normalize_non_stream_plugin_result(
                    model=model, prompt_messages=prompt_messages, result=result
                )
        except Exception as e:
            self._trigger_invoke_error_callbacks(
                model=model,
                ex=e,
                credentials=credentials,
                prompt_messages=prompt_messages,
                model_parameters=model_parameters,
                tools=tools,
                stop=stop,
                stream=stream,
                user=user,
                callbacks=callbacks,
            )

            # TODO
            raise self._transform_invoke_error(e)

        if stream and isinstance(result, Generator):
            return self._invoke_result_generator(
                model=model,
                result=result,
                credentials=credentials,
                prompt_messages=prompt_messages,
                model_parameters=model_parameters,
                tools=tools,
                stop=stop,
                stream=stream,
                user=user,
                callbacks=callbacks,
            )
        elif isinstance(result, LLMResult):
            self._trigger_after_invoke_callbacks(
                model=model,
                result=result,
                credentials=credentials,
                prompt_messages=prompt_messages,
                model_parameters=model_parameters,
                tools=tools,
                stop=stop,
                stream=stream,
                user=user,
                callbacks=callbacks,
            )
            # Following https://github.com/langgenius/dify/issues/17799,
            # we removed the prompt_messages from the chunk on the plugin daemon side.
            # To ensure compatibility, we add the prompt_messages back here.
            result.prompt_messages = prompt_messages
            return result
        raise NotImplementedError("unsupported invoke result type", type(result))

    def _invoke_result_generator(
        self,
        model: str,
        result: Generator[LLMResultChunk, None, None],
        credentials: dict,
        prompt_messages: Sequence[PromptMessage],
        model_parameters: dict,
        tools: list[PromptMessageTool] | None = None,
        stop: Sequence[str] | None = None,
        stream: bool = True,
        user: str | None = None,
        callbacks: list[Callback] | None = None,
    ) -> Generator[LLMResultChunk, None, None]:
        """
        Invoke result generator

        :param result: result generator
        :return: result generator
        """
        callbacks = callbacks or []
        message_content: list[PromptMessageContentUnionTypes] = []
        usage = None
        system_fingerprint = None
        real_model = model

        def _update_message_content(content: str | list[PromptMessageContentUnionTypes] | None):
            if not content:
                return
            if isinstance(content, list):
                message_content.extend(content)
                return
            if isinstance(content, str):
                message_content.append(TextPromptMessageContent(data=content))
                return

        try:
            for chunk in result:
                # Following https://github.com/langgenius/dify/issues/17799,
                # we removed the prompt_messages from the chunk on the plugin daemon side.
                # To ensure compatibility, we add the prompt_messages back here.
                chunk.prompt_messages = prompt_messages
                yield chunk

                self._trigger_new_chunk_callbacks(
                    chunk=chunk,
                    model=model,
                    credentials=credentials,
                    prompt_messages=prompt_messages,
                    model_parameters=model_parameters,
                    tools=tools,
                    stop=stop,
                    stream=stream,
                    user=user,
                    callbacks=callbacks,
                )

                _update_message_content(chunk.delta.message.content)

                real_model = chunk.model
                if chunk.delta.usage:
                    usage = chunk.delta.usage

                if chunk.system_fingerprint:
                    system_fingerprint = chunk.system_fingerprint
        except Exception as e:
            raise self._transform_invoke_error(e)

        assistant_message = AssistantPromptMessage(content=message_content)
        self._trigger_after_invoke_callbacks(
            model=model,
            result=LLMResult(
                model=real_model,
                prompt_messages=prompt_messages,
                message=assistant_message,
                usage=usage or LLMUsage.empty_usage(),
                system_fingerprint=system_fingerprint,
            ),
            credentials=credentials,
            prompt_messages=prompt_messages,
            model_parameters=model_parameters,
            tools=tools,
            stop=stop,
            stream=stream,
            user=user,
            callbacks=callbacks,
        )

    def get_num_tokens(
        self,
        model: str,
        credentials: dict,
        prompt_messages: list[PromptMessage],
        tools: list[PromptMessageTool] | None = None,
    ) -> int:
        """
        Get number of tokens for given prompt messages

        :param model: model name
        :param credentials: model credentials
        :param prompt_messages: prompt messages
        :param tools: tools for tool calling
        :return:
        """
        if dify_config.PLUGIN_BASED_TOKEN_COUNTING_ENABLED:
            from core.plugin.impl.model import PluginModelClient

            plugin_model_manager = PluginModelClient()
            return plugin_model_manager.get_llm_num_tokens(
                tenant_id=self.tenant_id,
                user_id="unknown",
                plugin_id=self.plugin_id,
                provider=self.provider_name,
                model_type=self.model_type.value,
                model=model,
                credentials=credentials,
                prompt_messages=prompt_messages,
                tools=tools,
            )
        return 0

    def calc_response_usage(
        self, model: str, credentials: dict, prompt_tokens: int, completion_tokens: int
    ) -> LLMUsage:
        """
        Calculate response usage

        :param model: model name
        :param credentials: model credentials
        :param prompt_tokens: prompt tokens
        :param completion_tokens: completion tokens
        :return: usage
        """
        # get prompt price info
        prompt_price_info = self.get_price(
            model=model,
            credentials=credentials,
            price_type=PriceType.INPUT,
            tokens=prompt_tokens,
        )

        # get completion price info
        completion_price_info = self.get_price(
            model=model, credentials=credentials, price_type=PriceType.OUTPUT, tokens=completion_tokens
        )

        # transform usage
        usage = LLMUsage(
            prompt_tokens=prompt_tokens,
            prompt_unit_price=prompt_price_info.unit_price,
            prompt_price_unit=prompt_price_info.unit,
            prompt_price=prompt_price_info.total_amount,
            completion_tokens=completion_tokens,
            completion_unit_price=completion_price_info.unit_price,
            completion_price_unit=completion_price_info.unit,
            completion_price=completion_price_info.total_amount,
            total_tokens=prompt_tokens + completion_tokens,
            total_price=prompt_price_info.total_amount + completion_price_info.total_amount,
            currency=prompt_price_info.currency,
            latency=time.perf_counter() - self.started_at,
        )

        return usage

    def _trigger_before_invoke_callbacks(
        self,
        model: str,
        credentials: dict,
        prompt_messages: list[PromptMessage],
        model_parameters: dict,
        tools: list[PromptMessageTool] | None = None,
        stop: Sequence[str] | None = None,
        stream: bool = True,
        user: str | None = None,
        callbacks: list[Callback] | None = None,
    ):
        """
        Trigger before invoke callbacks

        :param model: model name
        :param credentials: model credentials
        :param prompt_messages: prompt messages
        :param model_parameters: model parameters
        :param tools: tools for tool calling
        :param stop: stop words
        :param stream: is stream response
        :param user: unique user id
        :param callbacks: callbacks
        """
        _run_callbacks(
            callbacks,
            event="on_before_invoke",
            invoke=lambda callback: callback.on_before_invoke(
                llm_instance=self,
                model=model,
                credentials=credentials,
                prompt_messages=prompt_messages,
                model_parameters=model_parameters,
                tools=tools,
                stop=stop,
                stream=stream,
                user=user,
            ),
        )

    def _trigger_new_chunk_callbacks(
        self,
        chunk: LLMResultChunk,
        model: str,
        credentials: dict,
        prompt_messages: Sequence[PromptMessage],
        model_parameters: dict,
        tools: list[PromptMessageTool] | None = None,
        stop: Sequence[str] | None = None,
        stream: bool = True,
        user: str | None = None,
        callbacks: list[Callback] | None = None,
    ):
        """
        Trigger new chunk callbacks

        :param chunk: chunk
        :param model: model name
        :param credentials: model credentials
        :param prompt_messages: prompt messages
        :param model_parameters: model parameters
        :param tools: tools for tool calling
        :param stop: stop words
        :param stream: is stream response
        :param user: unique user id
        """
        _run_callbacks(
            callbacks,
            event="on_new_chunk",
            invoke=lambda callback: callback.on_new_chunk(
                llm_instance=self,
                chunk=chunk,
                model=model,
                credentials=credentials,
                prompt_messages=prompt_messages,
                model_parameters=model_parameters,
                tools=tools,
                stop=stop,
                stream=stream,
                user=user,
            ),
        )

    def _trigger_after_invoke_callbacks(
        self,
        model: str,
        result: LLMResult,
        credentials: dict,
        prompt_messages: Sequence[PromptMessage],
        model_parameters: dict,
        tools: list[PromptMessageTool] | None = None,
        stop: Sequence[str] | None = None,
        stream: bool = True,
        user: str | None = None,
        callbacks: list[Callback] | None = None,
    ):
        """
        Trigger after invoke callbacks

        :param model: model name
        :param result: result
        :param credentials: model credentials
        :param prompt_messages: prompt messages
        :param model_parameters: model parameters
        :param tools: tools for tool calling
        :param stop: stop words
        :param stream: is stream response
        :param user: unique user id
        :param callbacks: callbacks
        """
        _run_callbacks(
            callbacks,
            event="on_after_invoke",
            invoke=lambda callback: callback.on_after_invoke(
                llm_instance=self,
                result=result,
                model=model,
                credentials=credentials,
                prompt_messages=prompt_messages,
                model_parameters=model_parameters,
                tools=tools,
                stop=stop,
                stream=stream,
                user=user,
            ),
        )

    def _trigger_invoke_error_callbacks(
        self,
        model: str,
        ex: Exception,
        credentials: dict,
        prompt_messages: list[PromptMessage],
        model_parameters: dict,
        tools: list[PromptMessageTool] | None = None,
        stop: Sequence[str] | None = None,
        stream: bool = True,
        user: str | None = None,
        callbacks: list[Callback] | None = None,
    ):
        """
        Trigger invoke error callbacks

        :param model: model name
        :param ex: exception
        :param credentials: model credentials
        :param prompt_messages: prompt messages
        :param model_parameters: model parameters
        :param tools: tools for tool calling
        :param stop: stop words
        :param stream: is stream response
        :param user: unique user id
        :param callbacks: callbacks
        """
        _run_callbacks(
            callbacks,
            event="on_invoke_error",
            invoke=lambda callback: callback.on_invoke_error(
                llm_instance=self,
                ex=ex,
                model=model,
                credentials=credentials,
                prompt_messages=prompt_messages,
                model_parameters=model_parameters,
                tools=tools,
                stop=stop,
                stream=stream,
                user=user,
            ),
        )
