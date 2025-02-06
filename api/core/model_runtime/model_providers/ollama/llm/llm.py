import json
import logging
import re
from collections.abc import Generator
from decimal import Decimal
from typing import Optional, Union, cast
from urllib.parse import urljoin

import requests

from core.model_runtime.entities.llm_entities import (
    LLMMode,
    LLMResult,
    LLMResultChunk,
    LLMResultChunkDelta,
)
from core.model_runtime.entities.message_entities import (
    AssistantPromptMessage,
    ImagePromptMessageContent,
    PromptMessage,
    PromptMessageContentType,
    PromptMessageTool,
    SystemPromptMessage,
    TextPromptMessageContent,
    ToolPromptMessage,
    UserPromptMessage,
)
from core.model_runtime.entities.model_entities import (
    AIModelEntity,
    DefaultParameterName,
    FetchFrom,
    I18nObject,
    ModelFeature,
    ModelPropertyKey,
    ModelType,
    ParameterRule,
    ParameterType,
    PriceConfig,
)
from core.model_runtime.errors.invoke import (
    InvokeAuthorizationError,
    InvokeBadRequestError,
    InvokeConnectionError,
    InvokeError,
    InvokeRateLimitError,
    InvokeServerUnavailableError,
)
from core.model_runtime.errors.validate import CredentialsValidateFailedError
from core.model_runtime.model_providers.__base.large_language_model import (
    LargeLanguageModel,
)

logger = logging.getLogger(__name__)


class OllamaLargeLanguageModel(LargeLanguageModel):
    """
    Model class for Ollama large language model.
    """

    def _invoke(
        self,
        model: str,
        credentials: dict,
        prompt_messages: list[PromptMessage],
        model_parameters: dict,
        tools: Optional[list[PromptMessageTool]] = None,
        stop: Optional[list[str]] = None,
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
        return self._generate(
            model=model,
            credentials=credentials,
            prompt_messages=prompt_messages,
            model_parameters=model_parameters,
            tools=tools,
            stop=stop,
            stream=stream,
            user=user,
        )

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
        # get model mode
        model_mode = self.get_model_mode(model, credentials)

        if model_mode == LLMMode.CHAT:
            # chat model
            return self._num_tokens_from_messages(prompt_messages)
        else:
            first_prompt_message = prompt_messages[0]
            if isinstance(first_prompt_message.content, str):
                text = first_prompt_message.content
            else:
                text = ""
                for message_content in first_prompt_message.content:
                    if message_content.type == PromptMessageContentType.TEXT:
                        message_content = cast(TextPromptMessageContent, message_content)
                        text = message_content.data
                        break
            return self._get_num_tokens_by_gpt2(text)

    def validate_credentials(self, model: str, credentials: dict) -> None:
        """
        Validate model credentials

        :param model: model name
        :param credentials: model credentials
        :return:
        """
        try:
            self._generate(
                model=model,
                credentials=credentials,
                prompt_messages=[UserPromptMessage(content="ping")],
                model_parameters={"num_predict": 5},
                stream=False,
            )
        except InvokeError as ex:
            raise CredentialsValidateFailedError(f"An error occurred during credentials validation: {ex.description}")
        except Exception as ex:
            raise CredentialsValidateFailedError(f"An error occurred during credentials validation: {str(ex)}")

    def _generate(
        self,
        model: str,
        credentials: dict,
        prompt_messages: list[PromptMessage],
        model_parameters: dict,
        tools: Optional[list[PromptMessageTool]] = None,
        stop: Optional[list[str]] = None,
        stream: bool = True,
        user: Optional[str] = None,
    ) -> Union[LLMResult, Generator]:
        """
        Invoke llm completion model

        :param model: model name
        :param credentials: credentials
        :param prompt_messages: prompt messages
        :param model_parameters: model parameters
        :param stop: stop words
        :param stream: is stream response
        :param user: unique user id
        :return: full response or stream response chunk generator result
        """
        headers = {"Content-Type": "application/json"}

        endpoint_url = credentials["base_url"]
        if not endpoint_url.endswith("/"):
            endpoint_url += "/"

        # prepare the payload for a simple ping to the model
        data = {"model": model, "stream": stream}

        if format_schema := model_parameters.pop("format", None):
            try:
                data["format"] = format_schema if format_schema == "json" else json.loads(format_schema)
            except json.JSONDecodeError as e:
                raise InvokeBadRequestError(f"Invalid format schema: {str(e)}")

        if "keep_alive" in model_parameters:
            data["keep_alive"] = model_parameters["keep_alive"]
            del model_parameters["keep_alive"]

        data["options"] = model_parameters or {}

        if stop:
            data["options"]["stop"] = stop

        completion_type = LLMMode.value_of(credentials["mode"])

        if completion_type is LLMMode.CHAT:
            endpoint_url = urljoin(endpoint_url, "api/chat")
            data["messages"] = [self._convert_prompt_message_to_dict(m) for m in prompt_messages]
            if tools:
                data["tools"] = [self._convert_prompt_message_tool_to_dict(tool) for tool in tools]
        else:
            endpoint_url = urljoin(endpoint_url, "api/generate")
            first_prompt_message = prompt_messages[0]
            if isinstance(first_prompt_message, UserPromptMessage):
                first_prompt_message = cast(UserPromptMessage, first_prompt_message)
                if isinstance(first_prompt_message.content, str):
                    data["prompt"] = first_prompt_message.content
                else:
                    text = ""
                    images = []
                    for message_content in first_prompt_message.content:
                        if message_content.type == PromptMessageContentType.TEXT:
                            message_content = cast(TextPromptMessageContent, message_content)
                            text = message_content.data
                        elif message_content.type == PromptMessageContentType.IMAGE:
                            message_content = cast(ImagePromptMessageContent, message_content)
                            image_data = re.sub(
                                r"^data:image\/[a-zA-Z]+;base64,",
                                "",
                                message_content.data,
                            )
                            images.append(image_data)

                    data["prompt"] = text
                    data["images"] = images

        # send a post request to validate the credentials
        response = requests.post(endpoint_url, headers=headers, json=data, timeout=(10, 300), stream=stream)

        response.encoding = "utf-8"
        if response.status_code != 200:
            raise InvokeError(f"API request failed with status code {response.status_code}: {response.text}")

        if stream:
            return self._handle_generate_stream_response(model, credentials, completion_type, response, prompt_messages)

        return self._handle_generate_response(model, credentials, completion_type, response, prompt_messages, tools)

    def _handle_generate_response(
        self,
        model: str,
        credentials: dict,
        completion_type: LLMMode,
        response: requests.Response,
        prompt_messages: list[PromptMessage],
        tools: Optional[list[PromptMessageTool]],
    ) -> LLMResult:
        """
        Handle llm completion response

        :param model: model name
        :param credentials: model credentials
        :param completion_type: completion type
        :param response: response
        :param prompt_messages: prompt messages
        :return: llm result
        """
        response_json = response.json()
        tool_calls = []
        if completion_type is LLMMode.CHAT:
            message = response_json.get("message", {})
            response_content = message.get("content", "")
            response_tool_calls = message.get("tool_calls", [])
            tool_calls = [self._extract_response_tool_call(tool_call) for tool_call in response_tool_calls]
        else:
            response_content = response_json["response"]

        assistant_message = AssistantPromptMessage(content=response_content, tool_calls=tool_calls)

        if "prompt_eval_count" in response_json and "eval_count" in response_json:
            # transform usage
            prompt_tokens = response_json["prompt_eval_count"]
            completion_tokens = response_json["eval_count"]
        else:
            # calculate num tokens
            prompt_tokens = self._get_num_tokens_by_gpt2(prompt_messages[0].content)
            completion_tokens = self._get_num_tokens_by_gpt2(assistant_message.content)

        # transform usage
        usage = self._calc_response_usage(model, credentials, prompt_tokens, completion_tokens)

        # transform response
        result = LLMResult(
            model=response_json["model"],
            prompt_messages=prompt_messages,
            message=assistant_message,
            usage=usage,
        )

        return result

    def _handle_generate_stream_response(
        self,
        model: str,
        credentials: dict,
        completion_type: LLMMode,
        response: requests.Response,
        prompt_messages: list[PromptMessage],
    ) -> Generator:
        """
        Handle llm completion stream response

        :param model: model name
        :param credentials: model credentials
        :param completion_type: completion type
        :param response: response
        :param prompt_messages: prompt messages
        :return: llm response chunk generator result
        """
        full_text = ""
        chunk_index = 0
        is_reasoning_started = False

        def create_final_llm_result_chunk(
            index: int, message: AssistantPromptMessage, finish_reason: str
        ) -> LLMResultChunk:
            # calculate num tokens
            prompt_tokens = self._get_num_tokens_by_gpt2(prompt_messages[0].content)
            completion_tokens = self._get_num_tokens_by_gpt2(full_text)

            # transform usage
            usage = self._calc_response_usage(model, credentials, prompt_tokens, completion_tokens)

            return LLMResultChunk(
                model=model,
                prompt_messages=prompt_messages,
                delta=LLMResultChunkDelta(
                    index=index,
                    message=message,
                    finish_reason=finish_reason,
                    usage=usage,
                ),
            )

        for chunk in response.iter_lines(decode_unicode=True, delimiter="\n"):
            if not chunk:
                continue

            try:
                chunk_json = json.loads(chunk)
                # stream ended
            except json.JSONDecodeError as e:
                yield create_final_llm_result_chunk(
                    index=chunk_index,
                    message=AssistantPromptMessage(content=""),
                    finish_reason="Non-JSON encountered.",
                )

                chunk_index += 1
                break

            if completion_type is LLMMode.CHAT:
                if not chunk_json:
                    continue

                if "message" not in chunk_json:
                    text = ""
                else:
                    text = chunk_json.get("message").get("content", "")
            else:
                if not chunk_json:
                    continue

                # transform assistant message to prompt message
                text = chunk_json["response"]
            if "<think>" in text:
                is_reasoning_started = True
                text = text.replace("<think>", "> 💭 ")
            elif "</think>" in text:
                is_reasoning_started = False
                text = text.replace("</think>", "") + "\n\n"
            elif is_reasoning_started:
                text = text.replace("\n", "\n> ")

            assistant_prompt_message = AssistantPromptMessage(content=text)

            full_text += text

            if chunk_json["done"]:
                # calculate num tokens
                if "prompt_eval_count" in chunk_json:
                    prompt_tokens = chunk_json["prompt_eval_count"]
                else:
                    prompt_message_content = prompt_messages[0].content
                    if isinstance(prompt_message_content, str):
                        prompt_tokens = self._get_num_tokens_by_gpt2(prompt_message_content)
                    else:
                        content_text = ""
                        for message_content in prompt_message_content:
                            if message_content.type == PromptMessageContentType.TEXT:
                                message_content = cast(TextPromptMessageContent, message_content)
                                content_text += message_content.data
                        prompt_tokens = self._get_num_tokens_by_gpt2(content_text)

                completion_tokens = chunk_json.get("eval_count", self._get_num_tokens_by_gpt2(full_text))

                # transform usage
                usage = self._calc_response_usage(model, credentials, prompt_tokens, completion_tokens)

                yield LLMResultChunk(
                    model=chunk_json["model"],
                    prompt_messages=prompt_messages,
                    delta=LLMResultChunkDelta(
                        index=chunk_index,
                        message=assistant_prompt_message,
                        finish_reason="stop",
                        usage=usage,
                    ),
                )
            else:
                yield LLMResultChunk(
                    model=chunk_json["model"],
                    prompt_messages=prompt_messages,
                    delta=LLMResultChunkDelta(
                        index=chunk_index,
                        message=assistant_prompt_message,
                    ),
                )

            chunk_index += 1

    def _convert_prompt_message_tool_to_dict(self, tool: PromptMessageTool) -> dict:
        """
        Convert PromptMessageTool to dict for Ollama API

        :param tool: tool
        :return: tool dict
        """
        return {
            "type": "function",
            "function": {
                "name": tool.name,
                "description": tool.description,
                "parameters": tool.parameters,
            },
        }

    def _convert_prompt_message_to_dict(self, message: PromptMessage) -> dict:
        """
        Convert PromptMessage to dict for Ollama API

        :param message: prompt message
        :return: message dict
        """
        if isinstance(message, UserPromptMessage):
            message = cast(UserPromptMessage, message)
            if isinstance(message.content, str):
                message_dict = {"role": "user", "content": message.content}
            else:
                text = ""
                images = []
                for message_content in message.content:
                    if message_content.type == PromptMessageContentType.TEXT:
                        message_content = cast(TextPromptMessageContent, message_content)
                        text = message_content.data
                    elif message_content.type == PromptMessageContentType.IMAGE:
                        message_content = cast(ImagePromptMessageContent, message_content)
                        image_data = re.sub(r"^data:image\/[a-zA-Z]+;base64,", "", message_content.data)
                        images.append(image_data)

                message_dict = {"role": "user", "content": text, "images": images}
        elif isinstance(message, AssistantPromptMessage):
            message = cast(AssistantPromptMessage, message)
            message_dict = {"role": "assistant", "content": message.content}
        elif isinstance(message, SystemPromptMessage):
            message = cast(SystemPromptMessage, message)
            message_dict = {"role": "system", "content": message.content}
        elif isinstance(message, ToolPromptMessage):
            message = cast(ToolPromptMessage, message)
            message_dict = {"role": "tool", "content": message.content}
        else:
            raise ValueError(f"Got unknown type {message}")

        return message_dict

    def _num_tokens_from_messages(self, messages: list[PromptMessage]) -> int:
        """
        Calculate num tokens.

        :param messages: messages
        """
        num_tokens = 0
        messages_dict = [self._convert_prompt_message_to_dict(m) for m in messages]
        for message in messages_dict:
            for key, value in message.items():
                num_tokens += self._get_num_tokens_by_gpt2(str(key))
                num_tokens += self._get_num_tokens_by_gpt2(str(value))

        return num_tokens

    def _extract_response_tool_call(self, response_tool_call: dict) -> AssistantPromptMessage.ToolCall:
        """
        Extract response tool call
        """
        tool_call = None
        if response_tool_call and "function" in response_tool_call:
            # Convert arguments to JSON string if it's a dict
            arguments = response_tool_call.get("function").get("arguments")
            if isinstance(arguments, dict):
                arguments = json.dumps(arguments)

            function = AssistantPromptMessage.ToolCall.ToolCallFunction(
                name=response_tool_call.get("function").get("name"),
                arguments=arguments,
            )
            tool_call = AssistantPromptMessage.ToolCall(
                id=response_tool_call.get("function").get("name"),
                type="function",
                function=function,
            )

        return tool_call

    def get_customizable_model_schema(self, model: str, credentials: dict) -> AIModelEntity:
        """
        Get customizable model schema.

        :param model: model name
        :param credentials: credentials

        :return: model schema
        """
        extras = {
            "features": [],
        }

        if "vision_support" in credentials and credentials["vision_support"] == "true":
            extras["features"].append(ModelFeature.VISION)
        if "function_call_support" in credentials and credentials["function_call_support"] == "true":
            extras["features"].append(ModelFeature.TOOL_CALL)
            extras["features"].append(ModelFeature.MULTI_TOOL_CALL)

        entity = AIModelEntity(
            model=model,
            label=I18nObject(zh_Hans=model, en_US=model),
            model_type=ModelType.LLM,
            fetch_from=FetchFrom.CUSTOMIZABLE_MODEL,
            model_properties={
                ModelPropertyKey.MODE: credentials.get("mode"),
                ModelPropertyKey.CONTEXT_SIZE: int(credentials.get("context_size", 4096)),
            },
            parameter_rules=[
                ParameterRule(
                    name=DefaultParameterName.TEMPERATURE.value,
                    use_template=DefaultParameterName.TEMPERATURE.value,
                    label=I18nObject(en_US="Temperature", zh_Hans="温度"),
                    type=ParameterType.FLOAT,
                    help=I18nObject(
                        en_US="The temperature of the model. "
                        "Increasing the temperature will make the model answer "
                        "more creatively. (Default: 0.8)",
                        zh_Hans="模型的温度。增加温度将使模型的回答更具创造性。（默认值：0.8）",
                    ),
                    default=0.1,
                    min=0,
                    max=1,
                ),
                ParameterRule(
                    name=DefaultParameterName.TOP_P.value,
                    use_template=DefaultParameterName.TOP_P.value,
                    label=I18nObject(en_US="Top P", zh_Hans="Top P"),
                    type=ParameterType.FLOAT,
                    help=I18nObject(
                        en_US="Works together with top-k. A higher value (e.g., 0.95) will lead to "
                        "more diverse text, while a lower value (e.g., 0.5) will generate more "
                        "focused and conservative text. (Default: 0.9)",
                        zh_Hans="与top-k一起工作。较高的值（例如，0.95）会导致生成更多样化的文本，而较低的值（例如，0.5）会生成更专注和保守的文本。（默认值：0.9）",
                    ),
                    default=0.9,
                    min=0,
                    max=1,
                ),
                ParameterRule(
                    name="top_k",
                    label=I18nObject(en_US="Top K", zh_Hans="Top K"),
                    type=ParameterType.INT,
                    help=I18nObject(
                        en_US="Reduces the probability of generating nonsense. "
                        "A higher value (e.g. 100) will give more diverse answers, "
                        "while a lower value (e.g. 10) will be more conservative. (Default: 40)",
                        zh_Hans="减少生成无意义内容的可能性。较高的值（例如100）将提供更多样化的答案，而较低的值（例如10）将更为保守。（默认值：40）",
                    ),
                    min=1,
                    max=100,
                ),
                ParameterRule(
                    name="repeat_penalty",
                    label=I18nObject(en_US="Repeat Penalty"),
                    type=ParameterType.FLOAT,
                    help=I18nObject(
                        en_US="Sets how strongly to penalize repetitions. "
                        "A higher value (e.g., 1.5) will penalize repetitions more strongly, "
                        "while a lower value (e.g., 0.9) will be more lenient. (Default: 1.1)",
                        zh_Hans="设置对重复内容的惩罚强度。一个较高的值（例如，1.5）会更强地惩罚重复内容，而一个较低的值（例如，0.9）则会相对宽容。（默认值：1.1）",
                    ),
                    min=-2,
                    max=2,
                ),
                ParameterRule(
                    name="num_predict",
                    use_template="max_tokens",
                    label=I18nObject(en_US="Num Predict", zh_Hans="最大令牌数预测"),
                    type=ParameterType.INT,
                    help=I18nObject(
                        en_US="Maximum number of tokens to predict when generating text. "
                        "(Default: 128, -1 = infinite generation, -2 = fill context)",
                        zh_Hans="生成文本时预测的最大令牌数。（默认值：128，-1 = 无限生成，-2 = 填充上下文）",
                    ),
                    default=(512 if int(credentials.get("max_tokens", 4096)) >= 768 else 128),
                    min=-2,
                    max=int(credentials.get("max_tokens", 4096)),
                ),
                ParameterRule(
                    name="mirostat",
                    label=I18nObject(en_US="Mirostat sampling", zh_Hans="Mirostat 采样"),
                    type=ParameterType.INT,
                    help=I18nObject(
                        en_US="Enable Mirostat sampling for controlling perplexity. "
                        "(default: 0, 0 = disabled, 1 = Mirostat, 2 = Mirostat 2.0)",
                        zh_Hans="启用 Mirostat 采样以控制困惑度。"
                        "（默认值：0，0 = 禁用，1 = Mirostat，2 = Mirostat 2.0）",
                    ),
                    min=0,
                    max=2,
                ),
                ParameterRule(
                    name="mirostat_eta",
                    label=I18nObject(en_US="Mirostat Eta", zh_Hans="学习率"),
                    type=ParameterType.FLOAT,
                    help=I18nObject(
                        en_US="Influences how quickly the algorithm responds to feedback from "
                        "the generated text. A lower learning rate will result in slower adjustments, "
                        "while a higher learning rate will make the algorithm more responsive. "
                        "(Default: 0.1)",
                        zh_Hans="影响算法对生成文本反馈响应的速度。较低的学习率会导致调整速度变慢，而较高的学习率会使得算法更加灵敏。（默认值：0.1）",
                    ),
                    precision=1,
                ),
                ParameterRule(
                    name="mirostat_tau",
                    label=I18nObject(en_US="Mirostat Tau", zh_Hans="文本连贯度"),
                    type=ParameterType.FLOAT,
                    help=I18nObject(
                        en_US="Controls the balance between coherence and diversity of the output. "
                        "A lower value will result in more focused and coherent text. (Default: 5.0)",
                        zh_Hans="控制输出的连贯性和多样性之间的平衡。较低的值会导致更专注和连贯的文本。（默认值：5.0）",
                    ),
                    precision=1,
                ),
                ParameterRule(
                    name="num_ctx",
                    label=I18nObject(en_US="Size of context window", zh_Hans="上下文窗口大小"),
                    type=ParameterType.INT,
                    help=I18nObject(
                        en_US="Sets the size of the context window used to generate the next token. (Default: 2048)",
                        zh_Hans="设置用于生成下一个标记的上下文窗口大小。（默认值：2048）",
                    ),
                    default=2048,
                    min=1,
                ),
                ParameterRule(
                    name="num_gpu",
                    label=I18nObject(en_US="GPU Layers", zh_Hans="GPU 层数"),
                    type=ParameterType.INT,
                    help=I18nObject(
                        en_US="The number of layers to offload to the GPU(s). "
                        "On macOS it defaults to 1 to enable metal support, 0 to disable."
                        "As long as a model fits into one gpu it stays in one. "
                        "It does not set the number of GPU(s). ",
                        zh_Hans="加载到 GPU 的层数。在 macOS 上，默认为 1 以启用 Metal 支持，设置为 0 则禁用。"
                        "只要模型适合一个 GPU，它就保留在其中。它不设置 GPU 的数量。",
                    ),
                    min=-1,
                    default=1,
                ),
                ParameterRule(
                    name="num_thread",
                    label=I18nObject(en_US="Num Thread", zh_Hans="线程数"),
                    type=ParameterType.INT,
                    help=I18nObject(
                        en_US="Sets the number of threads to use during computation. "
                        "By default, Ollama will detect this for optimal performance. "
                        "It is recommended to set this value to the number of physical CPU cores "
                        "your system has (as opposed to the logical number of cores).",
                        zh_Hans="设置计算过程中使用的线程数。默认情况下，Ollama会检测以获得最佳性能。建议将此值设置为系统拥有的物理CPU核心数（而不是逻辑核心数）。",
                    ),
                    min=1,
                ),
                ParameterRule(
                    name="repeat_last_n",
                    label=I18nObject(en_US="Repeat last N", zh_Hans="回溯内容"),
                    type=ParameterType.INT,
                    help=I18nObject(
                        en_US="Sets how far back for the model to look back to prevent repetition. "
                        "(Default: 64, 0 = disabled, -1 = num_ctx)",
                        zh_Hans="设置模型回溯多远的内容以防止重复。（默认值：64，0 = 禁用，-1 = num_ctx）",
                    ),
                    min=-1,
                ),
                ParameterRule(
                    name="tfs_z",
                    label=I18nObject(en_US="TFS Z", zh_Hans="减少标记影响"),
                    type=ParameterType.FLOAT,
                    help=I18nObject(
                        en_US="Tail free sampling is used to reduce the impact of less probable tokens "
                        "from the output. A higher value (e.g., 2.0) will reduce the impact more, "
                        "while a value of 1.0 disables this setting. (default: 1)",
                        zh_Hans="用于减少输出中不太可能的标记的影响。较高的值（例如，2.0）会更多地减少这种影响，而1.0的值则会禁用此设置。（默认值：1）",
                    ),
                    precision=1,
                ),
                ParameterRule(
                    name="seed",
                    label=I18nObject(en_US="Seed", zh_Hans="随机数种子"),
                    type=ParameterType.INT,
                    help=I18nObject(
                        en_US="Sets the random number seed to use for generation. Setting this to "
                        "a specific number will make the model generate the same text for "
                        "the same prompt. (Default: 0)",
                        zh_Hans="设置用于生成的随机数种子。将此设置为特定数字将使模型对相同的提示生成相同的文本。（默认值：0）",
                    ),
                ),
                ParameterRule(
                    name="keep_alive",
                    label=I18nObject(en_US="Keep Alive", zh_Hans="模型存活时间"),
                    type=ParameterType.STRING,
                    help=I18nObject(
                        en_US="Sets how long the model is kept in memory after generating a response. "
                        "This must be a duration string with a unit (e.g., '10m' for 10 minutes or '24h' for 24 hours)."
                        " A negative number keeps the model loaded indefinitely, and '0' unloads the model"
                        " immediately after generating a response."
                        " Valid time units are 's','m','h'. (Default: 5m)",
                        zh_Hans="设置模型在生成响应后在内存中保留的时间。"
                        "这必须是一个带有单位的持续时间字符串（例如，'10m' 表示10分钟，'24h' 表示24小时）。"
                        "负数表示无限期地保留模型，'0'表示在生成响应后立即卸载模型。"
                        "有效的时间单位有 's'（秒）、'm'（分钟）、'h'（小时）。（默认值：5m）",
                    ),
                ),
                ParameterRule(
                    name="format",
                    label=I18nObject(en_US="Format", zh_Hans="返回格式"),
                    type=ParameterType.TEXT,
                    default="json",
                    help=I18nObject(
                        en_US="the format to return a response in. Format can be `json` or a JSON schema.",
                        zh_Hans="返回响应的格式。目前接受的值是字符串`json`或JSON schema.",
                    ),
                ),
            ],
            pricing=PriceConfig(
                input=Decimal(credentials.get("input_price", 0)),
                output=Decimal(credentials.get("output_price", 0)),
                unit=Decimal(credentials.get("unit", 0)),
                currency=credentials.get("currency", "USD"),
            ),
            **extras,
        )

        return entity

    @property
    def _invoke_error_mapping(self) -> dict[type[InvokeError], list[type[Exception]]]:
        """
        Map model invoke error to unified error
        The key is the error type thrown to the caller
        The value is the error type thrown by the model,
        which needs to be converted into a unified error type for the caller.

        :return: Invoke error mapping
        """
        return {
            InvokeAuthorizationError: [
                requests.exceptions.InvalidHeader,  # Missing or Invalid API Key
            ],
            InvokeBadRequestError: [
                requests.exceptions.HTTPError,  # Invalid Endpoint URL or model name
                requests.exceptions.InvalidURL,  # Misconfigured request or other API error
            ],
            InvokeRateLimitError: [
                requests.exceptions.RetryError  # Too many requests sent in a short period of time
            ],
            InvokeServerUnavailableError: [
                requests.exceptions.ConnectionError,  # Engine Overloaded
                requests.exceptions.HTTPError,  # Server Error
            ],
            InvokeConnectionError: [
                requests.exceptions.ConnectTimeout,  # Timeout
                requests.exceptions.ReadTimeout,  # Timeout
            ],
        }
