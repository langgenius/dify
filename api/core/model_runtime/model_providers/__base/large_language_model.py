import logging
import re
import time
from abc import abstractmethod
from collections.abc import Generator, Mapping, Sequence
from typing import Optional, Union

from pydantic import ConfigDict

from configs import dify_config
from core.model_runtime.callbacks.base_callback import Callback
from core.model_runtime.callbacks.logging_callback import LoggingCallback
from core.model_runtime.entities.llm_entities import LLMMode, LLMResult, LLMResultChunk, LLMResultChunkDelta, LLMUsage
from core.model_runtime.entities.message_entities import (
    AssistantPromptMessage,
    PromptMessage,
    PromptMessageContentType,
    PromptMessageTool,
    SystemPromptMessage,
    UserPromptMessage,
)
from core.model_runtime.entities.model_entities import (
    ModelPropertyKey,
    ModelType,
    ParameterRule,
    ParameterType,
    PriceType,
)
from core.model_runtime.model_providers.__base.ai_model import AIModel

logger = logging.getLogger(__name__)


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
        model_parameters: Optional[dict] = None,
        tools: Optional[list[PromptMessageTool]] = None,
        stop: Optional[Sequence[str]] = None,
        stream: bool = True,
        user: Optional[str] = None,
        callbacks: Optional[list[Callback]] = None,
    ) -> Union[LLMResult, Generator]:
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

        model_parameters = self._validate_and_filter_model_parameters(model, model_parameters, credentials)

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

        try:
            if "response_format" in model_parameters and model_parameters["response_format"] in {"JSON", "XML"}:
                result = self._code_block_mode_wrapper(
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
            else:
                result = self._invoke(
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

        return result

    def _code_block_mode_wrapper(
        self,
        model: str,
        credentials: dict,
        prompt_messages: list[PromptMessage],
        model_parameters: dict,
        tools: Optional[list[PromptMessageTool]] = None,
        stop: Optional[Sequence[str]] = None,
        stream: bool = True,
        user: Optional[str] = None,
        callbacks: Optional[list[Callback]] = None,
    ) -> Union[LLMResult, Generator]:
        """
        Code block mode wrapper, ensure the response is a code block with output markdown quote

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

        block_prompts = """You should always follow the instructions and output a valid {{block}} object.
The structure of the {{block}} object you can found in the instructions, use {"answer": "$your_answer"} as the default structure
if you are not sure about the structure.

<instructions>
{{instructions}}
</instructions>
"""  # noqa: E501

        code_block = model_parameters.get("response_format", "")
        if not code_block:
            return self._invoke(
                model=model,
                credentials=credentials,
                prompt_messages=prompt_messages,
                model_parameters=model_parameters,
                tools=tools,
                stop=stop,
                stream=stream,
                user=user,
            )

        model_parameters.pop("response_format")
        stop = list(stop) if stop is not None else []
        stop.extend(["\n```", "```\n"])
        block_prompts = block_prompts.replace("{{block}}", code_block)

        # check if there is a system message
        if len(prompt_messages) > 0 and isinstance(prompt_messages[0], SystemPromptMessage):
            # override the system message
            prompt_messages[0] = SystemPromptMessage(
                content=block_prompts.replace("{{instructions}}", str(prompt_messages[0].content))
            )
        else:
            # insert the system message
            prompt_messages.insert(
                0,
                SystemPromptMessage(
                    content=block_prompts.replace("{{instructions}}", f"Please output a valid {code_block} object.")
                ),
            )

        if len(prompt_messages) > 0 and isinstance(prompt_messages[-1], UserPromptMessage):
            # add ```JSON\n to the last text message
            if isinstance(prompt_messages[-1].content, str):
                prompt_messages[-1].content += f"\n```{code_block}\n"
            elif isinstance(prompt_messages[-1].content, list):
                for i in range(len(prompt_messages[-1].content) - 1, -1, -1):
                    if prompt_messages[-1].content[i].type == PromptMessageContentType.TEXT:
                        prompt_messages[-1].content[i].data += f"\n```{code_block}\n"
                        break
        else:
            # append a user message
            prompt_messages.append(UserPromptMessage(content=f"```{code_block}\n"))

        response = self._invoke(
            model=model,
            credentials=credentials,
            prompt_messages=prompt_messages,
            model_parameters=model_parameters,
            tools=tools,
            stop=stop,
            stream=stream,
            user=user,
        )

        if isinstance(response, Generator):
            first_chunk = next(response)

            def new_generator():
                yield first_chunk
                yield from response

            if first_chunk.delta.message.content and first_chunk.delta.message.content.startswith("`"):
                return self._code_block_mode_stream_processor_with_backtick(
                    model=model, prompt_messages=prompt_messages, input_generator=new_generator()
                )
            else:
                return self._code_block_mode_stream_processor(
                    model=model, prompt_messages=prompt_messages, input_generator=new_generator()
                )

        return response

    def _code_block_mode_stream_processor(
        self, model: str, prompt_messages: list[PromptMessage], input_generator: Generator[LLMResultChunk, None, None]
    ) -> Generator[LLMResultChunk, None, None]:
        """
        Code block mode stream processor, ensure the response is a code block with output markdown quote

        :param model: model name
        :param prompt_messages: prompt messages
        :param input_generator: input generator
        :return: output generator
        """
        state = "normal"
        backtick_count = 0
        for piece in input_generator:
            if piece.delta.message.content:
                content = piece.delta.message.content
                piece.delta.message.content = ""
                yield piece
                piece = content
            else:
                yield piece
                continue
            new_piece: str = ""
            for char in piece:
                char = str(char)
                if state == "normal":
                    if char == "`":
                        state = "in_backticks"
                        backtick_count = 1
                    else:
                        new_piece += char
                elif state == "in_backticks":
                    if char == "`":
                        backtick_count += 1
                        if backtick_count == 3:
                            state = "skip_content"
                            backtick_count = 0
                    else:
                        new_piece += "`" * backtick_count + char
                        state = "normal"
                        backtick_count = 0
                elif state == "skip_content":
                    if char.isspace():
                        state = "normal"

            if new_piece:
                yield LLMResultChunk(
                    model=model,
                    prompt_messages=prompt_messages,
                    delta=LLMResultChunkDelta(
                        index=0,
                        message=AssistantPromptMessage(content=new_piece, tool_calls=[]),
                    ),
                )

    def _code_block_mode_stream_processor_with_backtick(
        self, model: str, prompt_messages: list, input_generator: Generator[LLMResultChunk, None, None]
    ) -> Generator[LLMResultChunk, None, None]:
        """
        Code block mode stream processor, ensure the response is a code block with output markdown quote.
        This version skips the language identifier that follows the opening triple backticks.

        :param model: model name
        :param prompt_messages: prompt messages
        :param input_generator: input generator
        :return: output generator
        """
        state = "search_start"
        backtick_count = 0

        for piece in input_generator:
            if piece.delta.message.content:
                content = piece.delta.message.content
                # Reset content to ensure we're only processing and yielding the relevant parts
                piece.delta.message.content = ""
                # Yield a piece with cleared content before processing it to maintain the generator structure
                yield piece
                piece = content
            else:
                # Yield pieces without content directly
                yield piece
                continue

            if state == "done":
                continue

            new_piece: str = ""
            for char in piece:
                if state == "search_start":
                    if char == "`":
                        backtick_count += 1
                        if backtick_count == 3:
                            state = "skip_language"
                            backtick_count = 0
                    else:
                        backtick_count = 0
                elif state == "skip_language":
                    # Skip everything until the first newline, marking the end of the language identifier
                    if char == "\n":
                        state = "in_code_block"
                elif state == "in_code_block":
                    if char == "`":
                        backtick_count += 1
                        if backtick_count == 3:
                            state = "done"
                            break
                    else:
                        if backtick_count > 0:
                            # If backticks were counted but we're still collecting content, it was a false start
                            new_piece += "`" * backtick_count
                            backtick_count = 0
                        new_piece += str(char)

                elif state == "done":
                    break

            if new_piece:
                # Only yield content collected within the code block
                yield LLMResultChunk(
                    model=model,
                    prompt_messages=prompt_messages,
                    delta=LLMResultChunkDelta(
                        index=0,
                        message=AssistantPromptMessage(content=new_piece, tool_calls=[]),
                    ),
                )

    def _invoke_result_generator(
        self,
        model: str,
        result: Generator,
        credentials: dict,
        prompt_messages: list[PromptMessage],
        model_parameters: dict,
        tools: Optional[list[PromptMessageTool]] = None,
        stop: Optional[Sequence[str]] = None,
        stream: bool = True,
        user: Optional[str] = None,
        callbacks: Optional[list[Callback]] = None,
    ) -> Generator:
        """
        Invoke result generator

        :param result: result generator
        :return: result generator
        """
        callbacks = callbacks or []
        prompt_message = AssistantPromptMessage(content="")
        usage = None
        system_fingerprint = None
        real_model = model

        try:
            for chunk in result:
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

                prompt_message.content += chunk.delta.message.content
                real_model = chunk.model
                if chunk.delta.usage:
                    usage = chunk.delta.usage

                if chunk.system_fingerprint:
                    system_fingerprint = chunk.system_fingerprint
        except Exception as e:
            raise self._transform_invoke_error(e)

        self._trigger_after_invoke_callbacks(
            model=model,
            result=LLMResult(
                model=real_model,
                prompt_messages=prompt_messages,
                message=prompt_message,
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

    @abstractmethod
    def _invoke(
        self,
        model: str,
        credentials: dict,
        prompt_messages: list[PromptMessage],
        model_parameters: dict,
        tools: Optional[list[PromptMessageTool]] = None,
        stop: Optional[Sequence[str]] = None,
        stream: bool = True,
        user: Optional[str] = None,
    ) -> Union[LLMResult, Generator]:
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
        :return: full response or stream response chunk generator result
        """
        raise NotImplementedError

    @abstractmethod
    def get_num_tokens(
        self,
        model: str,
        credentials: dict,
        prompt_messages: list[PromptMessage],
        tools: Optional[list[PromptMessageTool]] = None,
    ) -> int:
        """
        Get number of tokens for given prompt messages

        :param model: model name
        :param credentials: model credentials
        :param prompt_messages: prompt messages
        :param tools: tools for tool calling
        :return:
        """
        raise NotImplementedError

    def enforce_stop_tokens(self, text: str, stop: list[str]) -> str:
        """Cut off the text as soon as any stop words occur."""
        return re.split("|".join(stop), text, maxsplit=1)[0]

    def get_parameter_rules(self, model: str, credentials: dict) -> list[ParameterRule]:
        """
        Get parameter rules

        :param model: model name
        :param credentials: model credentials
        :return: parameter rules
        """
        model_schema = self.get_model_schema(model, credentials)
        if model_schema:
            return model_schema.parameter_rules

        return []

    def get_model_mode(self, model: str, credentials: Optional[Mapping] = None) -> LLMMode:
        """
        Get model mode

        :param model: model name
        :param credentials: model credentials
        :return: model mode
        """
        model_schema = self.get_model_schema(model, credentials)

        mode = LLMMode.CHAT
        if model_schema and model_schema.model_properties.get(ModelPropertyKey.MODE):
            mode = LLMMode.value_of(model_schema.model_properties[ModelPropertyKey.MODE])

        return mode

    def _calc_response_usage(
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
        tools: Optional[list[PromptMessageTool]] = None,
        stop: Optional[Sequence[str]] = None,
        stream: bool = True,
        user: Optional[str] = None,
        callbacks: Optional[list[Callback]] = None,
    ) -> None:
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
                        logger.warning(f"Callback {callback.__class__.__name__} on_before_invoke failed with error {e}")

    def _trigger_new_chunk_callbacks(
        self,
        chunk: LLMResultChunk,
        model: str,
        credentials: dict,
        prompt_messages: list[PromptMessage],
        model_parameters: dict,
        tools: Optional[list[PromptMessageTool]] = None,
        stop: Optional[Sequence[str]] = None,
        stream: bool = True,
        user: Optional[str] = None,
        callbacks: Optional[list[Callback]] = None,
    ) -> None:
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
                        logger.warning(f"Callback {callback.__class__.__name__} on_new_chunk failed with error {e}")

    def _trigger_after_invoke_callbacks(
        self,
        model: str,
        result: LLMResult,
        credentials: dict,
        prompt_messages: list[PromptMessage],
        model_parameters: dict,
        tools: Optional[list[PromptMessageTool]] = None,
        stop: Optional[Sequence[str]] = None,
        stream: bool = True,
        user: Optional[str] = None,
        callbacks: Optional[list[Callback]] = None,
    ) -> None:
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
                        logger.warning(f"Callback {callback.__class__.__name__} on_after_invoke failed with error {e}")

    def _trigger_invoke_error_callbacks(
        self,
        model: str,
        ex: Exception,
        credentials: dict,
        prompt_messages: list[PromptMessage],
        model_parameters: dict,
        tools: Optional[list[PromptMessageTool]] = None,
        stop: Optional[Sequence[str]] = None,
        stream: bool = True,
        user: Optional[str] = None,
        callbacks: Optional[list[Callback]] = None,
    ) -> None:
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
                        logger.warning(f"Callback {callback.__class__.__name__} on_invoke_error failed with error {e}")

    def _validate_and_filter_model_parameters(self, model: str, model_parameters: dict, credentials: dict) -> dict:
        """
        Validate model parameters

        :param model: model name
        :param model_parameters: model parameters
        :param credentials: model credentials
        :return:
        """
        parameter_rules = self.get_parameter_rules(model, credentials)

        # validate model parameters
        filtered_model_parameters = {}
        for parameter_rule in parameter_rules:
            parameter_name = parameter_rule.name
            parameter_value = model_parameters.get(parameter_name)
            if parameter_value is None:
                if parameter_rule.use_template and parameter_rule.use_template in model_parameters:
                    # if parameter value is None, use template value variable name instead
                    parameter_value = model_parameters[parameter_rule.use_template]
                else:
                    if parameter_rule.required:
                        if parameter_rule.default is not None:
                            filtered_model_parameters[parameter_name] = parameter_rule.default
                            continue
                        else:
                            raise ValueError(f"Model Parameter {parameter_name} is required.")
                    else:
                        continue

            # validate parameter value type
            if parameter_rule.type == ParameterType.INT:
                if not isinstance(parameter_value, int):
                    raise ValueError(f"Model Parameter {parameter_name} should be int.")

                # validate parameter value range
                if parameter_rule.min is not None and parameter_value < parameter_rule.min:
                    raise ValueError(
                        f"Model Parameter {parameter_name} should be greater than or equal to {parameter_rule.min}."
                    )

                if parameter_rule.max is not None and parameter_value > parameter_rule.max:
                    raise ValueError(
                        f"Model Parameter {parameter_name} should be less than or equal to {parameter_rule.max}."
                    )
            elif parameter_rule.type == ParameterType.FLOAT:
                if not isinstance(parameter_value, float | int):
                    raise ValueError(f"Model Parameter {parameter_name} should be float.")

                # validate parameter value precision
                if parameter_rule.precision is not None:
                    if parameter_rule.precision == 0:
                        if parameter_value != int(parameter_value):
                            raise ValueError(f"Model Parameter {parameter_name} should be int.")
                    else:
                        if parameter_value != round(parameter_value, parameter_rule.precision):
                            raise ValueError(
                                f"Model Parameter {parameter_name} should be round to {parameter_rule.precision}"
                                f" decimal places."
                            )

                # validate parameter value range
                if parameter_rule.min is not None and parameter_value < parameter_rule.min:
                    raise ValueError(
                        f"Model Parameter {parameter_name} should be greater than or equal to {parameter_rule.min}."
                    )

                if parameter_rule.max is not None and parameter_value > parameter_rule.max:
                    raise ValueError(
                        f"Model Parameter {parameter_name} should be less than or equal to {parameter_rule.max}."
                    )
            elif parameter_rule.type == ParameterType.BOOLEAN:
                if not isinstance(parameter_value, bool):
                    raise ValueError(f"Model Parameter {parameter_name} should be bool.")
            elif parameter_rule.type == ParameterType.STRING:
                if not isinstance(parameter_value, str):
                    raise ValueError(f"Model Parameter {parameter_name} should be string.")

                # validate options
                if parameter_rule.options and parameter_value not in parameter_rule.options:
                    raise ValueError(f"Model Parameter {parameter_name} should be one of {parameter_rule.options}.")
            elif parameter_rule.type == ParameterType.TEXT:
                if not isinstance(parameter_value, str):
                    raise ValueError(f"Model Parameter {parameter_name} should be text.")

                # validate options
                if parameter_rule.options and parameter_value not in parameter_rule.options:
                    raise ValueError(f"Model Parameter {parameter_name} should be one of {parameter_rule.options}.")
            else:
                raise ValueError(f"Model Parameter {parameter_name} type {parameter_rule.type} is not supported.")

            filtered_model_parameters[parameter_name] = parameter_value

        return filtered_model_parameters
