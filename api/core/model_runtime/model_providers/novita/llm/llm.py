from collections.abc import Generator
from typing import Optional, Union
from urllib.parse import urljoin

import requests

from core.model_runtime.entities.llm_entities import LLMMode, LLMResult
from core.model_runtime.entities.message_entities import PromptMessage, PromptMessageTool
from core.model_runtime.entities.model_entities import AIModelEntity
from core.model_runtime.errors.invoke import InvokeError
from core.model_runtime.model_providers.openai_api_compatible.llm.llm import OAIAPICompatLargeLanguageModel
from core.model_runtime.utils import helper


class NovitaLargeLanguageModel(OAIAPICompatLargeLanguageModel):

    def _update_endpoint_url(self, credentials: dict):
        credentials['endpoint_url'] = "https://api.novita.ai/v3/openai"
        return credentials

    def _invoke(self, model: str, credentials: dict,
                prompt_messages: list[PromptMessage], model_parameters: dict,
                tools: Optional[list[PromptMessageTool]] = None, stop: Optional[list[str]] = None,
                stream: bool = True, user: Optional[str] = None) \
            -> Union[LLMResult, Generator]:
        cred_with_endpoint = self._update_endpoint_url(credentials=credentials)
        extra_headers = { 'X-Novita-Source': 'dify.ai' }
        return self._generate(model, cred_with_endpoint, prompt_messages, model_parameters, tools, stop, stream, user, extra_headers)
    def validate_credentials(self, model: str, credentials: dict) -> None:
        cred_with_endpoint = self._update_endpoint_url(credentials=credentials)
        self._add_custom_parameters(credentials, model)
        return super().validate_credentials(model, cred_with_endpoint)

    @classmethod
    def _add_custom_parameters(cls, credentials: dict, model: str) -> None:
        credentials['mode'] = 'chat'

    def _generate(self, model: str, credentials: dict, prompt_messages: list[PromptMessage], model_parameters: dict,
                  tools: Optional[list[PromptMessageTool]] = None, stop: Optional[list[str]] = None,
                  stream: bool = True, user: Optional[str] = None, extra_headers: Optional[dict] = None) -> Union[LLMResult, Generator]:
        cred_with_endpoint = self._update_endpoint_url(credentials=credentials)

        """
        Invoke llm completion model

        :param model: model name
        :param credentials: credentials
        :param prompt_messages: prompt messages
        :param model_parameters: model parameters
        :param stop: stop words
        :param stream: is stream response
        :param user: unique user id
        :param extra_headers: extra request headers
        :return: full response or stream response chunk generator result
        """
        headers = {
            'Content-Type': 'application/json',
            'Accept-Charset': 'utf-8',
            **extra_headers,
        }

        api_key = credentials.get('api_key')
        if api_key:
            headers["Authorization"] = f"Bearer {api_key}"

        endpoint_url = credentials["endpoint_url"]
        if not endpoint_url.endswith('/'):
            endpoint_url += '/'

        data = {
            "model": model,
            "stream": stream,
            **model_parameters
        }

        completion_type = LLMMode.value_of(credentials['mode'])

        if completion_type is LLMMode.CHAT:
            endpoint_url = urljoin(endpoint_url, 'chat/completions')
            data['messages'] = [self._convert_prompt_message_to_dict(m) for m in prompt_messages]
        elif completion_type is LLMMode.COMPLETION:
            endpoint_url = urljoin(endpoint_url, 'completions')
            data['prompt'] = prompt_messages[0].content
        else:
            raise ValueError("Unsupported completion type for model configuration.")

        # annotate tools with names, descriptions, etc.
        function_calling_type = credentials.get('function_calling_type', 'no_call')
        formatted_tools = []
        if tools:
            if function_calling_type == 'function_call':
                data['functions'] = [{
                    "name": tool.name,
                    "description": tool.description,
                    "parameters": tool.parameters
                } for tool in tools]
            elif function_calling_type == 'tool_call':
                data["tool_choice"] = "auto"

                for tool in tools:
                    formatted_tools.append(helper.dump_model(PromptMessageFunction(function=tool)))

                data["tools"] = formatted_tools

        if stop:
            data["stop"] = stop

        if user:
            data["user"] = user

        response = requests.post(
            endpoint_url,
            headers=headers,
            json=data,
            timeout=(10, 300),
            stream=stream
        )

        if response.encoding is None or response.encoding == 'ISO-8859-1':
            response.encoding = 'utf-8'

        if response.status_code != 200:
            raise InvokeError(f"API request failed with status code {response.status_code}: {response.text}")

        if stream:
            return super()._handle_generate_stream_response(model, credentials, response, prompt_messages)

        return super()._handle_generate_response(model, credentials, response, prompt_messages)

    def get_customizable_model_schema(self, model: str, credentials: dict) -> AIModelEntity:
        cred_with_endpoint = self._update_endpoint_url(credentials=credentials)

        return super().get_customizable_model_schema(model, cred_with_endpoint)

    def get_num_tokens(self, model: str, credentials: dict, prompt_messages: list[PromptMessage],
                       tools: Optional[list[PromptMessageTool]] = None) -> int:
        cred_with_endpoint = self._update_endpoint_url(credentials=credentials)

        return super().get_num_tokens(model, cred_with_endpoint, prompt_messages, tools)
