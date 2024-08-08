import base64
import json
import logging
import mimetypes
from collections.abc import Generator
from typing import Optional, Union, cast

# import google.ai.generativelanguage as glm
# import google.api_core.exceptions as exceptions
# import google.generativeai as genai
# import google.generativeai.client as client
# from google.generativeai.types import ContentType, GenerateContentResponse, HarmBlockThreshold, HarmCategory
# from google.generativeai.types.content_types import to_part
import oci
from oci.generative_ai_inference.models.base_chat_response import BaseChatResponse
import requests

from core.model_runtime.entities.llm_entities import LLMResult, LLMResultChunk, LLMResultChunkDelta
from core.model_runtime.entities.message_entities import (
    AssistantPromptMessage,
    ImagePromptMessageContent,
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

GEMINI_BLOCK_MODE_PROMPT = """You should always follow the instructions and output a valid {{block}} object.
The structure of the {{block}} object you can found in the instructions, use {"answer": "$your_answer"} as the default structure
if you are not sure about the structure.

<instructions>
{{instructions}}
</instructions>
"""

# https://docs.oracle.com/en-us/iaas/Content/generative-ai/pretrained-models.htm
_supported_models = {
    "meta.llama-3-70b-instruct": {
        "system": True,
        "multimodal": False,
        "tool_call": False,
        "stream_tool_call": False,
    },
    "cohere.command-r-16k": {
        "system": True,
        "multimodal": False,
        "tool_call": True,
        "stream_tool_call": False,
    },
    "cohere.command-r-plus": {
        "system": True,
        "multimodal": False,
        "tool_call": True,
        "stream_tool_call": False,
    },
}

# compartment_id = "ocid1.compartment.oc1..aaaaaaaaru3gkwxdbrs677wjoixqzjpogkjci6t75nvvwk54ee6lsjta7puq"
CONFIG_PROFILE = "GENERATEAI"
OCI_CONFIG = oci.config.from_file('~/.oci/config', CONFIG_PROFILE)
compartment_id = OCI_CONFIG["compartment_id"]
# Service endpoint
# endpoint = "https://inference.generativeai.us-chicago-1.oci.oraclecloud.com"
generative_ai_inference_client = oci.generative_ai_inference.GenerativeAiInferenceClient(config=OCI_CONFIG)

request_args = {
    "compartmentId": compartment_id,
    "servingMode": {
        "modelId": "cohere.command-r-plus",
        "servingType": "ON_DEMAND"
    },
    "chatRequest": {
        "apiFormat": "COHERE",
        "preambleOverride": "You are a helpful assistant.",
        "message": "Hello!",
        "chatHistory": [],
        "maxTokens": 2048,
        "isStream": False,
        "frequencyPenalty": 0,
        "presencePenalty": 0,
        "temperature": 1,
        "topP": 1
    }
}


class OCILargeLanguageModel(LargeLanguageModel):

    def _invoke(self, model: str, credentials: dict,
                prompt_messages: list[PromptMessage], model_parameters: dict,
                tools: Optional[list[PromptMessageTool]] = None, stop: Optional[list[str]] = None,
                stream: bool = True, user: Optional[str] = None) \
            -> Union[LLMResult, Generator]:
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
        # invoke model
        return self._generate(model, credentials, prompt_messages, model_parameters, tools, stop, stream, user)

    def get_num_tokens(self, model: str, credentials: dict, prompt_messages: list[PromptMessage],
                       tools: Optional[list[PromptMessageTool]] = None) -> int:
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

    def _convert_messages_to_prompt(self, messages: list[PromptMessage]) -> str:
        """
        Format a list of messages into a full prompt for the Google model

        :param messages: List of PromptMessage to combine.
        :return: Combined string with necessary human_prompt and ai_prompt tags.
        """
        messages = messages.copy()  # don't mutate the original list

        text = "".join(
            self._convert_one_message_to_text(message)
            for message in messages
        )

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
            #request_args["chatRequest"]["message"] = str(ping_message)
            #chat_response = generative_ai_inference_client.chat(request_args)
            # Print result
            #print("role--------")
            #role = ping_message.role.name
            #print(ping_message.role)
            #print("**************************Chat Result**************************")
            #print(vars(chat_response))

            self._generate(model, credentials, [ping_message], {"max_tokens_to_sample": 5})

        except Exception as ex:
            raise CredentialsValidateFailedError(str(ex))

    def _generate(self, model: str, credentials: dict,
                  prompt_messages: list[PromptMessage], model_parameters: dict,
                  tools: Optional[list[PromptMessageTool]] = None, stop: Optional[list[str]] = None,
                  stream: bool = True, user: Optional[str] = None
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
        chathistory = []
        system_prompts = []

        request_args["chatRequest"]["maxTokens"] = model_parameters.pop('max_tokens_to_sample', None)
        # for msg in prompt_messages:  # makes message roles strictly alternating
        #    content = self._format_message_to_glm_content(msg)
        #    if history and history[-1]["role"] == content["role"]:
        #        history[-1]["parts"].extend(content["parts"])
        #    else:
        #        history.append(content)
        if model.startswith("cohere"):
            for message in prompt_messages[:-1]:
                text = ""
                if isinstance(message.content, str):
                    text = message.content
                if isinstance(message, UserPromptMessage):
                    chathistory.append({"role": "USER", "message": text})
                else:
                    chathistory.append({"role": "CHATBOT", "message": text})
                if isinstance(message, SystemPromptMessage):
                    if isinstance(message.content, str):
                        system_prompts.append(message.content)
            args = {"apiFormat": "COHERE",
                    "preambleOverride": ' '.join(system_prompts),
                    "message": prompt_messages[-1].content,
                    "chatHistory": chathistory, }
            request_args["chatRequest"].update(args)
        elif model.startswith("meta"):
            meta_messages = []
            for message in prompt_messages:
                text = message.content
                meta_messages.append({"role": message.role.name, "content": [{"type": "TEXT", "text": text}]})
            args = {"apiFormat": "GENERIC",
                    "messages": meta_messages,
                    "numGenerations": 1,
                    "topK": -1}
            request_args["chatRequest"].update(args)
        response = generative_ai_inference_client.chat(request_args)
        print(vars(response))
        # response = google_model.generate_content(
        #    contents=history,
        #    generation_config=genai.types.GenerationConfig(
        #        **config_kwargs
        #    ),
        #    stream=stream,
        #    safety_settings=safety_settings,
        #    tools=self._convert_tools_to_glm_tool(tools) if tools else None,
        #    request_options={"timeout": 600}
        # )

        if stream:
            return self._handle_generate_stream_response(model, credentials, response, prompt_messages)

        return self._handle_generate_response(model, credentials, response, prompt_messages)

    def _handle_generate_response(self, model: str, credentials: dict, response: BaseChatResponse,
                                  prompt_messages: list[PromptMessage]) -> LLMResult:
        """
        Handle llm response

        :param model: model name
        :param credentials: credentials
        :param response: response
        :param prompt_messages: prompt messages
        :return: llm response
        """
        # transform assistant message to prompt message
        assistant_prompt_message = AssistantPromptMessage(
            content=response.data.chat_response.text
        )

        # calculate num tokens
        prompt_tokens = self.get_num_tokens(model, credentials, prompt_messages)
        completion_tokens = self.get_num_tokens(model, credentials, [assistant_prompt_message])

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

    def _handle_generate_stream_response(self, model: str, credentials: dict, response: BaseChatResponse,
                                         prompt_messages: list[PromptMessage]) -> Generator:
        """
        Handle llm stream response

        :param model: model name
        :param credentials: credentials
        :param response: response
        :param prompt_messages: prompt messages
        :return: llm response chunk generator result
        """
        index = -1
        for chunk in response:
            for part in chunk.parts:
                assistant_prompt_message = AssistantPromptMessage(
                    content=''
                )

                if part.text:
                    assistant_prompt_message.content += part.text

                if part.function_call:
                    assistant_prompt_message.tool_calls = [
                        AssistantPromptMessage.ToolCall(
                            id=part.function_call.name,
                            type='function',
                            function=AssistantPromptMessage.ToolCall.ToolCallFunction(
                                name=part.function_call.name,
                                arguments=json.dumps(dict(part.function_call.args.items()))
                            )
                        )
                    ]

                index += 1

                if not response._done:

                    # transform assistant message to prompt message
                    yield LLMResultChunk(
                        model=model,
                        prompt_messages=prompt_messages,
                        delta=LLMResultChunkDelta(
                            index=index,
                            message=assistant_prompt_message
                        )
                    )
                else:

                    # calculate num tokens
                    prompt_tokens = self.get_num_tokens(model, credentials, prompt_messages)
                    completion_tokens = self.get_num_tokens(model, credentials, [assistant_prompt_message])

                    # transform usage
                    usage = self._calc_response_usage(model, credentials, prompt_tokens, completion_tokens)

                    yield LLMResultChunk(
                        model=model,
                        prompt_messages=prompt_messages,
                        delta=LLMResultChunkDelta(
                            index=index,
                            message=assistant_prompt_message,
                            finish_reason=str(chunk.candidates[0].finish_reason),
                            usage=usage
                        )
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
            content = "".join(
                c.data for c in content if c.type != PromptMessageContentType.IMAGE
            )

        if isinstance(message, UserPromptMessage):
            message_text = f"{human_prompt} {content}"
        elif isinstance(message, AssistantPromptMessage):
            message_text = f"{ai_prompt} {content}"
        elif isinstance(message, SystemPromptMessage):
            message_text = f"{human_prompt} {content}"
        elif isinstance(message, ToolPromptMessage):
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
            InvokeBadRequestError: []
        }
