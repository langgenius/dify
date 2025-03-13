import base64
import copy
import json
import logging
from collections.abc import Generator
from typing import Optional, Union

import oci  # type: ignore
from oci.generative_ai_inference.models.base_chat_response import BaseChatResponse  # type: ignore

from core.model_runtime.entities.llm_entities import LLMResult, LLMResultChunk, LLMResultChunkDelta
from core.model_runtime.entities.message_entities import (
    AssistantPromptMessage,
    PromptMessage,
    PromptMessageContentType,
    PromptMessageTool,
    SystemPromptMessage,
    ToolPromptMessage,
    UserPromptMessage,
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
from core.model_runtime.model_providers.__base.large_language_model import LargeLanguageModel

logger = logging.getLogger(__name__)

request_template = {
    "compartmentId": "",
    "servingMode": {"modelId": "cohere.command-r-plus-08-2024", "servingType": "ON_DEMAND"},
    "chatRequest": {
        "apiFormat": "COHERE",
        # "preambleOverride": "You are a helpful assistant.",
        # "message": "Hello!",
        # "chatHistory": [],
        "maxTokens": 600,
        "isStream": False,
        "frequencyPenalty": 0,
        "presencePenalty": 0,
        "temperature": 1,
        "topP": 0.75,
    },
}
oci_config_template = {
    "user": "",
    "fingerprint": "",
    "tenancy": "",
    "region": "",
    "compartment_id": "",
    "key_content": "",
}


class OCILargeLanguageModel(LargeLanguageModel):
    # https://docs.oracle.com/en-us/iaas/Content/generative-ai/pretrained-models.htm
    _supported_models = {
        "meta.llama-3.1-70b-instruct": {
            "system": True,
            "multimodal": False,
            "tool_call": False,
            "stream_tool_call": False,
        },
        "cohere.command-r-08-2024": {
            "system": True,
            "multimodal": False,
            "tool_call": True,
            "stream_tool_call": False,
        },
        "cohere.command-r-plus-08-2024": {
            "system": True,
            "multimodal": False,
            "tool_call": True,
            "stream_tool_call": False,
        },
    }

    def _is_tool_call_supported(self, model_id: str, stream: bool = False) -> bool:
        feature = self._supported_models.get(model_id)
        if not feature:
            return False
        return feature["stream_tool_call"] if stream else feature["tool_call"]

    def _is_multimodal_supported(self, model_id: str) -> bool:
        feature = self._supported_models.get(model_id)
        if not feature:
            return False
        return feature["multimodal"]

    def _is_system_prompt_supported(self, model_id: str) -> bool:
        feature = self._supported_models.get(model_id)
        if not feature:
            return False
        return feature["system"]

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
        # print("model"+"*"*20)
        # print(model)
        # print("credentials"+"*"*20)
        # print(credentials)
        # print("model_parameters"+"*"*20)
        # print(model_parameters)
        # print("prompt_messages"+"*"*200)
        # print(prompt_messages)
        # print("tools"+"*"*20)
        # print(tools)

        # invoke model
        return self._generate(model, credentials, prompt_messages, model_parameters, tools, stop, stream, user)

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
        :return:md = genai.GenerativeModel(model)
        """
        prompt = self._convert_messages_to_prompt(prompt_messages)

        return self._get_num_tokens_by_gpt2(prompt)

    def get_num_characters(
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
        :return:md = genai.GenerativeModel(model)
        """
        prompt = self._convert_messages_to_prompt(prompt_messages)

        return len(prompt)

    def _convert_messages_to_prompt(self, messages: list[PromptMessage]) -> str:
        """
        :param messages: List of PromptMessage to combine.
        :return: Combined string with necessary human_prompt and ai_prompt tags.
        """
        messages = messages.copy()  # don't mutate the original list

        text = "".join(self._convert_one_message_to_text(message) for message in messages)

        return text.rstrip()

    def validate_credentials(self, model: str, credentials: dict) -> None:
        """
        Validate model credentials

        :param model: model name
        :param credentials: model credentials
        :return:
        """
        # Setup basic variables
        # Auth Config
        try:
            ping_message = SystemPromptMessage(content="ping")
            self._generate(model, credentials, [ping_message], {"maxTokens": 5})
        except Exception as ex:
            raise CredentialsValidateFailedError(str(ex))

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
        Invoke large language model

        :param model: model name
        :param credentials: credentials kwargs
        :param prompt_messages: prompt messages
        :param model_parameters: model parameters
        :param stop: stop words
        :param stream: is stream response
        :param user: unique user id
        :return: full response or stream response chunk generator result
        """
        # config_kwargs = model_parameters.copy()
        # config_kwargs['max_output_tokens'] = config_kwargs.pop('max_tokens_to_sample', None)
        # if stop:
        #    config_kwargs["stop_sequences"] = stop

        # initialize client
        # ref: https://docs.oracle.com/en-us/iaas/api/#/en/generative-ai-inference/20231130/ChatResult/Chat
        oci_config = copy.deepcopy(oci_config_template)
        if "oci_config_content" in credentials:
            oci_config_content = base64.b64decode(credentials.get("oci_config_content")).decode("utf-8")
            config_items = oci_config_content.split("/")
            if len(config_items) != 5:
                raise CredentialsValidateFailedError(
                    "oci_config_content should be base64.b64encode("
                    "'user_ocid/fingerprint/tenancy_ocid/region/compartment_ocid'.encode('utf-8'))"
                )
            oci_config["user"] = config_items[0]
            oci_config["fingerprint"] = config_items[1]
            oci_config["tenancy"] = config_items[2]
            oci_config["region"] = config_items[3]
            oci_config["compartment_id"] = config_items[4]
        else:
            raise CredentialsValidateFailedError("need to set oci_config_content in credentials ")
        if "oci_key_content" in credentials:
            oci_key_content = base64.b64decode(credentials.get("oci_key_content")).decode("utf-8")
            oci_config["key_content"] = oci_key_content.encode(encoding="utf-8")
        else:
            raise CredentialsValidateFailedError("need to set oci_config_content in credentials ")

        # oci_config = oci.config.from_file('~/.oci/config', credentials.get('oci_api_profile'))
        compartment_id = oci_config["compartment_id"]
        client = oci.generative_ai_inference.GenerativeAiInferenceClient(config=oci_config)
        # call embedding model
        request_args = copy.deepcopy(request_template)
        request_args["compartmentId"] = compartment_id
        request_args["servingMode"]["modelId"] = model

        chat_history = []
        system_prompts = []
        # if "meta.llama" in model:
        #    request_args["chatRequest"]["apiFormat"] = "GENERIC"
        request_args["chatRequest"]["maxTokens"] = model_parameters.pop("maxTokens", 600)
        request_args["chatRequest"].update(model_parameters)
        frequency_penalty = model_parameters.get("frequencyPenalty", 0)
        presence_penalty = model_parameters.get("presencePenalty", 0)
        if frequency_penalty > 0 and presence_penalty > 0:
            raise InvokeBadRequestError("Cannot set both frequency penalty and presence penalty")

        # for msg in prompt_messages:  # makes message roles strictly alternating
        #    content = self._format_message_to_glm_content(msg)
        #    if history and history[-1]["role"] == content["role"]:
        #        history[-1]["parts"].extend(content["parts"])
        #    else:
        #        history.append(content)

        # temporary not implement the tool call function
        valid_value = self._is_tool_call_supported(model, stream)
        if tools is not None and len(tools) > 0:
            if not valid_value:
                raise InvokeBadRequestError("Does not support function calling")
        if model.startswith("cohere"):
            # print("run cohere " * 10)
            for message in prompt_messages[:-1]:
                text = ""
                if isinstance(message.content, str):
                    text = message.content
                if isinstance(message, UserPromptMessage):
                    chat_history.append({"role": "USER", "message": text})
                else:
                    chat_history.append({"role": "CHATBOT", "message": text})
                if isinstance(message, SystemPromptMessage):
                    if isinstance(message.content, str):
                        system_prompts.append(message.content)
            args = {
                "apiFormat": "COHERE",
                "preambleOverride": " ".join(system_prompts),
                "message": prompt_messages[-1].content,
                "chatHistory": chat_history,
            }
            request_args["chatRequest"].update(args)
        elif model.startswith("meta"):
            # print("run meta " * 10)
            meta_messages = []
            for message in prompt_messages:
                text = message.content
                meta_messages.append({"role": message.role.name, "content": [{"type": "TEXT", "text": text}]})
            args = {"apiFormat": "GENERIC", "messages": meta_messages, "numGenerations": 1, "topK": -1}
            request_args["chatRequest"].update(args)

        if stream:
            request_args["chatRequest"]["isStream"] = True
        # print("final request" + "|" * 20)
        # print(request_args)
        response = client.chat(request_args)
        # print(vars(response))

        if stream:
            return self._handle_generate_stream_response(model, credentials, response, prompt_messages)

        return self._handle_generate_response(model, credentials, response, prompt_messages)

    def _handle_generate_response(
        self, model: str, credentials: dict, response: BaseChatResponse, prompt_messages: list[PromptMessage]
    ) -> LLMResult:
        """
        Handle llm response

        :param model: model name
        :param credentials: credentials
        :param response: response
        :param prompt_messages: prompt messages
        :return: llm response
        """
        # transform assistant message to prompt message
        assistant_prompt_message = AssistantPromptMessage(content=response.data.chat_response.text)

        # calculate num tokens
        prompt_tokens = self.get_num_characters(model, credentials, prompt_messages)
        completion_tokens = self.get_num_characters(model, credentials, [assistant_prompt_message])

        # transform usage
        usage = self._calc_response_usage(model, credentials, prompt_tokens, completion_tokens)

        # transform response
        result = LLMResult(
            model=model,
            prompt_messages=prompt_messages,
            message=assistant_prompt_message,
            usage=usage,
        )

        return result

    def _handle_generate_stream_response(
        self, model: str, credentials: dict, response: BaseChatResponse, prompt_messages: list[PromptMessage]
    ) -> Generator:
        """
        Handle llm stream response

        :param model: model name
        :param credentials: credentials
        :param response: response
        :param prompt_messages: prompt messages
        :return: llm response chunk generator result
        """
        index = -1
        events = response.data.events()
        for stream in events:
            chunk = json.loads(stream.data)
            # print(chunk)
            # chunk: {'apiFormat': 'COHERE', 'text': 'Hello'}

            # for chunk in response:
            # for part in chunk.parts:
            # if part.function_call:
            #    assistant_prompt_message.tool_calls = [
            #        AssistantPromptMessage.ToolCall(
            #            id=part.function_call.name,
            #            type='function',
            #            function=AssistantPromptMessage.ToolCall.ToolCallFunction(
            #                name=part.function_call.name,
            #                arguments=json.dumps(dict(part.function_call.args.items()))
            #            )
            #        )
            #    ]

            if "finishReason" not in chunk:
                assistant_prompt_message = AssistantPromptMessage(content="")
                if model.startswith("cohere"):
                    if chunk["text"]:
                        assistant_prompt_message.content += chunk["text"]
                elif model.startswith("meta"):
                    assistant_prompt_message.content += chunk["message"]["content"][0]["text"]
                index += 1
                # transform assistant message to prompt message
                yield LLMResultChunk(
                    model=model,
                    prompt_messages=prompt_messages,
                    delta=LLMResultChunkDelta(index=index, message=assistant_prompt_message),
                )
            else:
                # calculate num tokens
                prompt_tokens = self.get_num_characters(model, credentials, prompt_messages)
                completion_tokens = self.get_num_characters(model, credentials, [assistant_prompt_message])

                # transform usage
                usage = self._calc_response_usage(model, credentials, prompt_tokens, completion_tokens)

                yield LLMResultChunk(
                    model=model,
                    prompt_messages=prompt_messages,
                    delta=LLMResultChunkDelta(
                        index=index,
                        message=assistant_prompt_message,
                        finish_reason=str(chunk["finishReason"]),
                        usage=usage,
                    ),
                )

    def _convert_one_message_to_text(self, message: PromptMessage) -> str:
        """
        Convert a single message to a string.

        :param message: PromptMessage to convert.
        :return: String representation of the message.
        """
        human_prompt = "\n\nuser:"
        ai_prompt = "\n\nmodel:"

        content = message.content
        if isinstance(content, list):
            content = "".join(c.data for c in content if c.type != PromptMessageContentType.IMAGE)

        if isinstance(message, UserPromptMessage):
            message_text = f"{human_prompt} {content}"
        elif isinstance(message, AssistantPromptMessage):
            message_text = f"{ai_prompt} {content}"
        elif isinstance(message, SystemPromptMessage | ToolPromptMessage):
            message_text = f"{human_prompt} {content}"
        else:
            raise ValueError(f"Got unknown type {message}")

        return message_text

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
            InvokeConnectionError: [],
            InvokeServerUnavailableError: [],
            InvokeRateLimitError: [],
            InvokeAuthorizationError: [],
            InvokeBadRequestError: [],
        }
