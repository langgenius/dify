import logging
import time
import uuid
from collections.abc import Generator, Sequence
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


def _increase_tool_call(
    new_tool_calls: list[AssistantPromptMessage.ToolCall], existing_tools_calls: list[AssistantPromptMessage.ToolCall]
):
    """
    Merge incremental tool call updates into existing tool calls.

    :param new_tool_calls: List of new tool call deltas to be merged.
    :param existing_tools_calls: List of existing tool calls to be modified IN-PLACE.
    """

    def get_tool_call(tool_call_id: str):
        """
        Get or create a tool call by ID

        :param tool_call_id: tool call ID
        :return: existing or new tool call
        """
        if not tool_call_id:
            return existing_tools_calls[-1]

        _tool_call = next((_tool_call for _tool_call in existing_tools_calls if _tool_call.id == tool_call_id), None)
        if _tool_call is None:
            _tool_call = AssistantPromptMessage.ToolCall(
                id=tool_call_id,
                type="function",
                function=AssistantPromptMessage.ToolCall.ToolCallFunction(name="", arguments=""),
            )
            existing_tools_calls.append(_tool_call)

        return _tool_call

    for new_tool_call in new_tool_calls:
        # generate ID for tool calls with function name but no ID to track them
        if new_tool_call.function.name and not new_tool_call.id:
            new_tool_call.id = _gen_tool_call_id()
        # get tool call
        tool_call = get_tool_call(new_tool_call.id)
        # update tool call
        if new_tool_call.id:
            tool_call.id = new_tool_call.id
        if new_tool_call.type:
            tool_call.type = new_tool_call.type
        if new_tool_call.function.name:
            tool_call.function.name = new_tool_call.function.name
        if new_tool_call.function.arguments:
            tool_call.function.arguments += new_tool_call.function.arguments


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
            from core.plugin.impl.model import PluginModelClient

            plugin_model_manager = PluginModelClient()
            result = plugin_model_manager.invoke_llm(
                tenant_id=self.tenant_id,
                user_id=user or "unknown",
                plugin_id=self.plugin_id,
                provider=self.provider_name,
                model=model,
                credentials=credentials,
                model_parameters=model_parameters,
                prompt_messages=prompt_messages,
                tools=tools,
                stop=list(stop) if stop else None,
                stream=stream,
            )

            if not stream:
                content = ""
                content_list = []
                usage = LLMUsage.empty_usage()
                system_fingerprint = None
                tools_calls: list[AssistantPromptMessage.ToolCall] = []

                for chunk in result:
                    if isinstance(chunk.delta.message.content, str):
                        content += chunk.delta.message.content
                    elif isinstance(chunk.delta.message.content, list):
                        content_list.extend(chunk.delta.message.content)
                    if chunk.delta.message.tool_calls:
                        _increase_tool_call(chunk.delta.message.tool_calls, tools_calls)

                    usage = chunk.delta.usage or LLMUsage.empty_usage()
                    system_fingerprint = chunk.system_fingerprint
                    break

                result = LLMResult(
                    model=model,
                    prompt_messages=prompt_messages,
                    message=AssistantPromptMessage(
                        content=content or content_list,
                        tool_calls=tools_calls,
                    ),
                    usage=usage,
                    system_fingerprint=system_fingerprint,
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
        if callbacks:
            for callback in callbacks:
                try:
                    callback.on_before_invoke(
                        llm_instance=self,
                        model=model,
                        credentials=credentials,
                        prompt_messages=prompt_messages,
                        model_parameters=model_parameters,
                        tools=tools,
                        stop=stop,
                        stream=stream,
                        user=user,
                    )
                except Exception as e:
                    if callback.raise_error:
                        raise e
                    else:
                        logger.warning(
                            "Callback %s on_before_invoke failed with error %s", callback.__class__.__name__, e
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
        if callbacks:
            for callback in callbacks:
                try:
                    callback.on_new_chunk(
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
                    )
                except Exception as e:
                    if callback.raise_error:
                        raise e
                    else:
                        logger.warning("Callback %s on_new_chunk failed with error %s", callback.__class__.__name__, e)

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
        if callbacks:
            for callback in callbacks:
                try:
                    callback.on_after_invoke(
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
                    )
                except Exception as e:
                    if callback.raise_error:
                        raise e
                    else:
                        logger.warning(
                            "Callback %s on_after_invoke failed with error %s", callback.__class__.__name__, e
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
        if callbacks:
            for callback in callbacks:
                try:
                    callback.on_invoke_error(
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
                    )
                except Exception as e:
                    if callback.raise_error:
                        raise e
                    else:
                        logger.warning(
                            "Callback %s on_invoke_error failed with error %s", callback.__class__.__name__, e
                        )
