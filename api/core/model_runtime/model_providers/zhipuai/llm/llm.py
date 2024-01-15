import json
from typing import Any, Dict, Generator, List, Optional, Union

from core.model_runtime.entities.llm_entities import LLMResult, LLMResultChunk, LLMResultChunkDelta
from core.model_runtime.entities.message_entities import (AssistantPromptMessage, PromptMessage, PromptMessageRole,
                                                          PromptMessageTool, SystemPromptMessage, UserPromptMessage)
from core.model_runtime.errors.validate import CredentialsValidateFailedError
from core.model_runtime.model_providers.__base.large_language_model import LargeLanguageModel
from core.model_runtime.model_providers.zhipuai._client import ZhipuModelAPI
from core.model_runtime.model_providers.zhipuai._common import _CommonZhipuaiAI


class ZhipuAILargeLanguageModel(_CommonZhipuaiAI, LargeLanguageModel):

    def _invoke(self, model: str, credentials: dict,
                prompt_messages: list[PromptMessage], model_parameters: dict,
                tools: Optional[list[PromptMessageTool]] = None, stop: Optional[List[str]] = None,
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
        # transform credentials to kwargs for model instance
        credentials_kwargs = self._to_credential_kwargs(credentials)

        # invoke model
        return self._generate(model, credentials_kwargs, prompt_messages, model_parameters, stop, stream, user)

    def get_num_tokens(self, model: str, credentials: dict, prompt_messages: list[PromptMessage],
                       tools: Optional[list[PromptMessageTool]] = None) -> int:
        """
        Get number of tokens for given prompt messages

        :param model: model name
        :param credentials: model credentials
        :param prompt_messages: prompt messages
        :param tools: tools for tool calling
        :return:
        """
        prompt = self._convert_messages_to_prompt(prompt_messages)

        return self._get_num_tokens_by_gpt2(prompt)

    def validate_credentials(self, model: str, credentials: dict) -> None:
        """
        Validate model credentials

        :param model: model name
        :param credentials: model credentials
        :return:
        """
        try:
            # transform credentials to kwargs for model instance
            credentials_kwargs = self._to_credential_kwargs(credentials)
            self._generate(
                model=model,
                credentials_kwargs=credentials_kwargs,
                prompt_messages=[
                    UserPromptMessage(content="ping"),
                ],
                model_parameters={
                    "temperature": 0.5,
                },
                stream=False
            )
        except Exception as ex:
            raise CredentialsValidateFailedError(str(ex))

    def _generate(self, model: str, credentials_kwargs: dict,
                  prompt_messages: list[PromptMessage], model_parameters: dict,
                  stop: Optional[List[str]] = None, stream: bool = True,
                  user: Optional[str] = None) -> Union[LLMResult, Generator]:
        """
        Invoke large language model

        :param model: model name
        :param credentials_kwargs: credentials kwargs
        :param prompt_messages: prompt messages
        :param model_parameters: model parameters
        :param stop: stop words
        :param stream: is stream response
        :param user: unique user id
        :return: full response or stream response chunk generator result
        """
        extra_model_kwargs = {}
        if stop:
            extra_model_kwargs['stop_sequences'] = stop

        client = ZhipuModelAPI(
            api_key=credentials_kwargs['api_key']
        )

        if len(prompt_messages) == 0:
            raise ValueError('At least one message is required')
        
        if prompt_messages[0].role == PromptMessageRole.SYSTEM:
            if not prompt_messages[0].content:
                prompt_messages = prompt_messages[1:]

        # resolve zhipuai model not support system message and user message, assistant message must be in sequence
        new_prompt_messages = []
        for prompt_message in prompt_messages:
            copy_prompt_message = prompt_message.copy()
            if copy_prompt_message.role in [PromptMessageRole.USER, PromptMessageRole.SYSTEM, PromptMessageRole.TOOL]:
                if not isinstance(copy_prompt_message.content, str):
                    # not support image message
                    continue

                if new_prompt_messages and new_prompt_messages[-1].role == PromptMessageRole.USER:
                    new_prompt_messages[-1].content += "\n\n" + copy_prompt_message.content
                else:
                    if copy_prompt_message.role == PromptMessageRole.USER:
                        new_prompt_messages.append(copy_prompt_message)
                    else:
                        new_prompt_message = UserPromptMessage(content=copy_prompt_message.content)
                        new_prompt_messages.append(new_prompt_message)
            else:
                if new_prompt_messages and new_prompt_messages[-1].role == PromptMessageRole.ASSISTANT:
                    new_prompt_messages[-1].content += "\n\n" + copy_prompt_message.content
                else:
                    new_prompt_messages.append(copy_prompt_message)

        params = {
            'model': model,
            'prompt': [{
                'role': prompt_message.role.value,
                'content': prompt_message.content
            } for prompt_message in new_prompt_messages],
            **model_parameters
        }

        if stream:
            response = client.sse_invoke(incremental=True, **params).events()
            return self._handle_generate_stream_response(model, credentials_kwargs, response, prompt_messages)

        response = client.invoke(**params)
        return self._handle_generate_response(model, credentials_kwargs, response, prompt_messages)
        
    def _handle_generate_response(self, model: str, 
                                  credentials: dict,
                                  response: Dict[str, Any],
                                  prompt_messages: list[PromptMessage]) -> LLMResult:
        """
        Handle llm response

        :param model: model name
        :param response: response
        :param prompt_messages: prompt messages
        :return: llm response
        """
        data = response["data"]
        text = ''
        for res in data["choices"]:
            text += res['content']
          
        token_usage = data.get("usage")
        if token_usage is not None:
            if 'prompt_tokens' not in token_usage:
                token_usage['prompt_tokens'] = 0
            if 'completion_tokens' not in token_usage:
                token_usage['completion_tokens'] = token_usage['total_tokens']

        # transform usage
        usage = self._calc_response_usage(model, credentials, token_usage['prompt_tokens'], token_usage['completion_tokens'])

        # transform response
        result = LLMResult(
            model=model,
            prompt_messages=prompt_messages,
            message=AssistantPromptMessage(content=text),
            usage=usage,
        )

        return result

    def _handle_generate_stream_response(self, model: str, 
                                         credentials: dict,
                                         responses: list[Generator],
                                         prompt_messages: list[PromptMessage]) -> Generator:
        """
        Handle llm stream response

        :param model: model name
        :param response: response
        :param prompt_messages: prompt messages
        :return: llm response chunk generator result
        """
        for index, event in enumerate(responses):
            if event.event == "add":
                yield LLMResultChunk(
                    prompt_messages=prompt_messages,
                    model=model,
                    delta=LLMResultChunkDelta(
                        index=index,
                        message=AssistantPromptMessage(content=event.data)
                    )
                )
            elif event.event == "error" or event.event == "interrupted":
                raise ValueError(
                    f"{event.data}"
                )
            elif event.event == "finish":
                meta = json.loads(event.meta)
                token_usage = meta['usage']
                if token_usage is not None:
                    if 'prompt_tokens' not in token_usage:
                        token_usage['prompt_tokens'] = 0
                    if 'completion_tokens' not in token_usage:
                        token_usage['completion_tokens'] = token_usage['total_tokens']

                usage = self._calc_response_usage(model, credentials, token_usage['prompt_tokens'], token_usage['completion_tokens'])

                yield LLMResultChunk(
                    model=model,
                    prompt_messages=prompt_messages,
                    delta=LLMResultChunkDelta(
                        index=index,
                        message=AssistantPromptMessage(content=event.data),
                        finish_reason='finish',
                        usage=usage
                    )
                )

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
    
    def _convert_messages_to_prompt(self, messages: List[PromptMessage]) -> str:
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
