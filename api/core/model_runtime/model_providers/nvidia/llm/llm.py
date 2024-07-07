import json
from collections.abc import Generator
from typing import Optional, Union

import requests
from yarl import URL

from core.model_runtime.entities.llm_entities import LLMMode, LLMResult
from core.model_runtime.entities.message_entities import (
    PromptMessage,
    PromptMessageContentType,
    PromptMessageFunction,
    PromptMessageTool,
    UserPromptMessage,
)
from core.model_runtime.errors.invoke import InvokeError
from core.model_runtime.errors.validate import CredentialsValidateFailedError
from core.model_runtime.model_providers.openai_api_compatible.llm.llm import OAIAPICompatLargeLanguageModel
from core.model_runtime.utils import helper


class NVIDIALargeLanguageModel(OAIAPICompatLargeLanguageModel):
    MODEL_SUFFIX_MAP = {
        'fuyu-8b': 'vlm/adept/fuyu-8b',
        'mistralai/mistral-large': '',
        'mistralai/mixtral-8x7b-instruct-v0.1': '',
        'mistralai/mixtral-8x22b-instruct-v0.1': '',
        'google/gemma-7b': '',
        'google/codegemma-7b': '',
        'snowflake/arctic':'',
        'meta/llama2-70b': '',
        'meta/llama3-8b-instruct': '',
        'meta/llama3-70b-instruct': '',
        'google/recurrentgemma-2b': ''
        
    }

    def _invoke(self, model: str, credentials: dict,
                prompt_messages: list[PromptMessage], model_parameters: dict,
                tools: Optional[list[PromptMessageTool]] = None, stop: Optional[list[str]] = None,
                stream: bool = True, user: Optional[str] = None) \
            -> Union[LLMResult, Generator]:
        
        self._add_custom_parameters(credentials, model)
        prompt_messages = self._transform_prompt_messages(prompt_messages)
        stop = []
        user = None

        return super()._invoke(model, credentials, prompt_messages, model_parameters, tools, stop, stream, user)

    def _transform_prompt_messages(self, prompt_messages: list[PromptMessage]) -> list[PromptMessage]:
        """
        Handle Image transform
        """
        for i, p in enumerate(prompt_messages):
            if isinstance(p, UserPromptMessage) and isinstance(p.content, list):
                content = p.content
                content_text = ''
                for prompt_content in content:
                    if prompt_content.type == PromptMessageContentType.TEXT:
                        content_text += prompt_content.data
                    else:
                        content_text += f' <img src="{prompt_content.data}" />'

                prompt_message = UserPromptMessage(
                    content=content_text
                )
                prompt_messages[i] = prompt_message
        return prompt_messages

    def validate_credentials(self, model: str, credentials: dict) -> None:
        self._add_custom_parameters(credentials, model)
        self._validate_credentials(model, credentials)

    def _add_custom_parameters(self, credentials: dict, model: str) -> None:
        credentials['mode'] = 'chat'
        
        if self.MODEL_SUFFIX_MAP[model]:
            credentials['server_url'] = f'https://ai.api.nvidia.com/v1/{self.MODEL_SUFFIX_MAP[model]}'
            credentials.pop('endpoint_url')
        else:
            credentials['endpoint_url'] = 'https://integrate.api.nvidia.com/v1'

        credentials['stream_mode_delimiter'] = '\n'

    def _validate_credentials(self, model: str, credentials: dict) -> None:
        """
        Validate model credentials using requests to ensure compatibility with all providers following OpenAI's API standard.

        :param model: model name
        :param credentials: model credentials
        :return:
        """
        try:
            headers = {
                'Content-Type': 'application/json'
            }

            api_key = credentials.get('api_key')
            if api_key:
                headers["Authorization"] = f"Bearer {api_key}"

            endpoint_url = credentials.get('endpoint_url')
            if endpoint_url and not endpoint_url.endswith('/'):
                endpoint_url += '/'
            server_url = credentials.get('server_url')

            # prepare the payload for a simple ping to the model
            data = {
                'model': model,
                'max_tokens': 5
            }

            completion_type = LLMMode.value_of(credentials['mode'])

            if completion_type is LLMMode.CHAT:
                data['messages'] = [
                    {
                        "role": "user",
                        "content": "ping"
                    },
                ]
                if 'endpoint_url' in credentials:
                    endpoint_url = str(URL(endpoint_url) / 'chat' / 'completions')
                elif 'server_url' in credentials:
                    endpoint_url = server_url
            elif completion_type is LLMMode.COMPLETION:
                data['prompt'] = 'ping'
                if 'endpoint_url' in credentials:
                    endpoint_url = str(URL(endpoint_url) / 'completions')
                elif 'server_url' in credentials:
                    endpoint_url = server_url
            else:
                raise ValueError("Unsupported completion type for model configuration.")

            # send a post request to validate the credentials
            response = requests.post(
                endpoint_url,
                headers=headers,
                json=data,
                timeout=(10, 300)
            )

            if response.status_code != 200:
                raise CredentialsValidateFailedError(
                    f'Credentials validation failed with status code {response.status_code}')

            try:
                json_result = response.json()
            except json.JSONDecodeError as e:
                raise CredentialsValidateFailedError('Credentials validation failed: JSON decode error')
        except CredentialsValidateFailedError:
            raise
        except Exception as ex:
            raise CredentialsValidateFailedError(f'An error occurred during credentials validation: {str(ex)}')

    def _generate(self, model: str, credentials: dict, prompt_messages: list[PromptMessage], model_parameters: dict,
                  tools: Optional[list[PromptMessageTool]] = None, stop: Optional[list[str]] = None,
                  stream: bool = True, \
                  user: Optional[str] = None) -> Union[LLMResult, Generator]:
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
        headers = {
            'Content-Type': 'application/json',
            'Accept-Charset': 'utf-8',
        }

        api_key = credentials.get('api_key')
        if api_key:
            headers['Authorization'] = f'Bearer {api_key}'

        if stream:
            headers['Accept'] = 'text/event-stream'

        endpoint_url = credentials.get('endpoint_url')
        if endpoint_url and not endpoint_url.endswith('/'):
            endpoint_url += '/'
        server_url = credentials.get('server_url')

        data = {
            "model": model,
            "stream": stream,
            **model_parameters
        }

        completion_type = LLMMode.value_of(credentials['mode'])

        if completion_type is LLMMode.CHAT:
            if 'endpoint_url' in credentials:
                endpoint_url = str(URL(endpoint_url) / 'chat' / 'completions')
            elif 'server_url' in credentials:
                endpoint_url = server_url
            data['messages'] = [self._convert_prompt_message_to_dict(m, credentials) for m in prompt_messages]
        elif completion_type is LLMMode.COMPLETION:
            data['prompt'] = 'ping'
            if 'endpoint_url' in credentials:
                endpoint_url = str(URL(endpoint_url) / 'completions')
            elif 'server_url' in credentials:
                endpoint_url = server_url
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

        if not response.ok:
            raise InvokeError(f"API request failed with status code {response.status_code}: {response.text}")

        if stream:
            return self._handle_generate_stream_response(model, credentials, response, prompt_messages)

        return self._handle_generate_response(model, credentials, response, prompt_messages)
