import json
import logging
from collections.abc import Generator

from tencentcloud.common import credential
from tencentcloud.common.exception import TencentCloudSDKException
from tencentcloud.common.profile.client_profile import ClientProfile
from tencentcloud.common.profile.http_profile import HttpProfile
from tencentcloud.hunyuan.v20230901 import hunyuan_client, models

from core.model_runtime.entities.llm_entities import LLMResult, LLMResultChunk, LLMResultChunkDelta
from core.model_runtime.entities.message_entities import (
    AssistantPromptMessage,
    PromptMessage,
    PromptMessageTool,
    SystemPromptMessage,
    UserPromptMessage,
)
from core.model_runtime.errors.invoke import InvokeError
from core.model_runtime.errors.validate import CredentialsValidateFailedError
from core.model_runtime.model_providers.__base.large_language_model import LargeLanguageModel

logger = logging.getLogger(__name__)

class HunyuanLargeLanguageModel(LargeLanguageModel):

    def _invoke(self, model: str, credentials: dict, prompt_messages: list[PromptMessage],
                model_parameters: dict, tools: list[PromptMessageTool] | None = None,
                stop: list[str] | None = None, stream: bool = True, user: str | None = None) \
            -> LLMResult | Generator:

        client = self._setup_hunyuan_client(credentials)
        request = models.ChatCompletionsRequest()
        messages_dict = self._convert_prompt_messages_to_dicts(prompt_messages)

        custom_parameters = {
            'Temperature': model_parameters.get('temperature', 0.0),
            'TopP': model_parameters.get('top_p', 1.0)
        }

        params = {
            "Model": model,
            "Messages": messages_dict,
            "Stream": stream,
            **custom_parameters,
        }

        request.from_json_string(json.dumps(params))
        response = client.ChatCompletions(request)

        if stream:
            return self._handle_stream_chat_response(model, credentials, prompt_messages, response)

        return self._handle_chat_response(credentials, model, prompt_messages, response)

    def validate_credentials(self, model: str, credentials: dict) -> None:
        """
        Validate credentials
        """
        try:
            client = self._setup_hunyuan_client(credentials)

            req = models.ChatCompletionsRequest()
            params = {
                "Model": model,
                "Messages": [{
                    "Role": "user",
                    "Content": "hello"
                }],
                "TopP": 1,
                "Temperature": 0,
                "Stream": False
            }
            req.from_json_string(json.dumps(params))
            client.ChatCompletions(req)
        except Exception as e:
            raise CredentialsValidateFailedError(f'Credentials validation failed: {e}')

    def _setup_hunyuan_client(self, credentials):
        secret_id = credentials['secret_id']
        secret_key = credentials['secret_key']
        cred = credential.Credential(secret_id, secret_key)
        httpProfile = HttpProfile()
        httpProfile.endpoint = "hunyuan.tencentcloudapi.com"
        clientProfile = ClientProfile()
        clientProfile.httpProfile = httpProfile
        client = hunyuan_client.HunyuanClient(cred, "", clientProfile)
        return client

    def _convert_prompt_messages_to_dicts(self, prompt_messages: list[PromptMessage]) -> list[dict]:
        """Convert a list of PromptMessage objects to a list of dictionaries with 'Role' and 'Content' keys."""
        return [{"Role": message.role.value, "Content": message.content} for message in prompt_messages]

    def _handle_stream_chat_response(self, model, credentials, prompt_messages, resp):
        for index, event in enumerate(resp):
            logging.debug("_handle_stream_chat_response, event: %s", event)

            data_str = event['data']
            data = json.loads(data_str)

            choices = data.get('Choices', [])
            if not choices:
                continue
            choice = choices[0]
            delta = choice.get('Delta', {})
            message_content = delta.get('Content', '')
            finish_reason = choice.get('FinishReason', '')

            usage = data.get('Usage', {})
            prompt_tokens = usage.get('PromptTokens', 0)
            completion_tokens = usage.get('CompletionTokens', 0)
            usage = self._calc_response_usage(model, credentials, prompt_tokens, completion_tokens)

            assistant_prompt_message = AssistantPromptMessage(
                content=message_content,
                tool_calls=[]
            )

            delta_chunk = LLMResultChunkDelta(
                index=index,
                role=delta.get('Role', 'assistant'),
                message=assistant_prompt_message,
                usage=usage,
                finish_reason=finish_reason,
            )

            yield LLMResultChunk(
                model=model,
                prompt_messages=prompt_messages,
                delta=delta_chunk,
            )

    def _handle_chat_response(self, credentials, model, prompt_messages, response):
        usage = self._calc_response_usage(model, credentials, response.Usage.PromptTokens,
                                          response.Usage.CompletionTokens)
        assistant_prompt_message = PromptMessage(role="assistant")
        assistant_prompt_message.content = response.Choices[0].Message.Content
        result = LLMResult(
            model=model,
            prompt_messages=prompt_messages,
            message=assistant_prompt_message,
            usage=usage,
        )

        return result

    def get_num_tokens(self, model: str, credentials: dict, prompt_messages: list[PromptMessage],
                       tools: list[PromptMessageTool] | None = None) -> int:
        if len(prompt_messages) == 0:
            return 0
        prompt = self._convert_messages_to_prompt(prompt_messages)
        return self._get_num_tokens_by_gpt2(prompt)

    def _convert_messages_to_prompt(self, messages: list[PromptMessage]) -> str:
        """
        Format a list of messages into a full prompt for the Anthropic model

        :param messages: List of PromptMessage to combine.
        :return: Combined string with necessary human_prompt and ai_prompt tags.
        """
        messages = messages.copy()  # don't mutate the original list

        text = "".join(
            self._convert_one_message_to_text(message)
            for message in messages
        )

        # trim off the trailing ' ' that might come from the "Assistant: "
        return text.rstrip()

    def _convert_one_message_to_text(self, message: PromptMessage) -> str:
        """
        Convert a single message to a string.

        :param message: PromptMessage to convert.
        :return: String representation of the message.
        """
        human_prompt = "\n\nHuman:"
        ai_prompt = "\n\nAssistant:"
        content = message.content

        if isinstance(message, UserPromptMessage):
            message_text = f"{human_prompt} {content}"
        elif isinstance(message, AssistantPromptMessage):
            message_text = f"{ai_prompt} {content}"
        elif isinstance(message, SystemPromptMessage):
            message_text = content
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
            InvokeError: [TencentCloudSDKException],
        }
