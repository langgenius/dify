from collections.abc import Generator
from typing import Optional, Union

from core.model_runtime.entities.llm_entities import LLMResult, LLMResultChunk, LLMResultChunkDelta
from core.model_runtime.entities.message_entities import (
    AssistantPromptMessage,
    PromptMessage,
    PromptMessageContent,
    PromptMessageContentType,
    PromptMessageRole,
    PromptMessageTool,
    SystemPromptMessage,
    ToolPromptMessage,
    UserPromptMessage,
)
from core.model_runtime.errors.validate import CredentialsValidateFailedError
from core.model_runtime.model_providers.__base.large_language_model import LargeLanguageModel
from core.model_runtime.model_providers.zhipuai._common import _CommonZhipuaiAI
from core.model_runtime.model_providers.zhipuai.zhipuai_sdk._client import ZhipuAI
from core.model_runtime.model_providers.zhipuai.zhipuai_sdk.types.chat.chat_completion import Completion
from core.model_runtime.model_providers.zhipuai.zhipuai_sdk.types.chat.chat_completion_chunk import ChatCompletionChunk
from core.model_runtime.utils import helper

GLM_JSON_MODE_PROMPT = """You should always follow the instructions and output a valid JSON object.
The structure of the JSON object you can found in the instructions, use {"answer": "$your_answer"} as the default structure
if you are not sure about the structure.

And you should always end the block with a "```" to indicate the end of the JSON object.

<instructions>
{{instructions}}
</instructions>

```JSON"""


class ZhipuAILargeLanguageModel(_CommonZhipuaiAI, LargeLanguageModel):

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
        # transform credentials to kwargs for model instance
        credentials_kwargs = self._to_credential_kwargs(credentials)

        # invoke model
        # stop = stop or []
        # self._transform_json_prompts(model, credentials, prompt_messages, model_parameters, tools, stop, stream, user)
        return self._generate(model, credentials_kwargs, prompt_messages, model_parameters, tools, stop, stream, user)

    # def _transform_json_prompts(self, model: str, credentials: dict, 
    #                             prompt_messages: list[PromptMessage], model_parameters: dict, 
    #                             tools: list[PromptMessageTool] | None = None, stop: list[str] | None = None, 
    #                             stream: bool = True, user: str | None = None) \
    #                         -> None:
    #     """
    #     Transform json prompts to model prompts
    #     """
    #     if "}\n\n" not in stop:
    #         stop.append("}\n\n")

    #     # check if there is a system message
    #     if len(prompt_messages) > 0 and isinstance(prompt_messages[0], SystemPromptMessage):
    #         # override the system message
    #         prompt_messages[0] = SystemPromptMessage(
    #             content=GLM_JSON_MODE_PROMPT.replace("{{instructions}}", prompt_messages[0].content)
    #         )
    #     else:
    #         # insert the system message
    #         prompt_messages.insert(0, SystemPromptMessage(
    #             content=GLM_JSON_MODE_PROMPT.replace("{{instructions}}", "Please output a valid JSON object.")
    #         ))
    #     # check if the last message is a user message
    #     if len(prompt_messages) > 0 and isinstance(prompt_messages[-1], UserPromptMessage):
    #         # add ```JSON\n to the last message
    #         prompt_messages[-1].content += "\n```JSON\n"
    #     else:
    #         # append a user message
    #         prompt_messages.append(UserPromptMessage(
    #             content="```JSON\n"
    #         ))

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
        prompt = self._convert_messages_to_prompt(prompt_messages, tools)

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
                tools=[],
                stream=False
            )
        except Exception as ex:
            raise CredentialsValidateFailedError(str(ex))

    def _generate(self, model: str, credentials_kwargs: dict,
                  prompt_messages: list[PromptMessage], model_parameters: dict,
                  tools: Optional[list[PromptMessageTool]] = None,
                  stop: Optional[list[str]] = None, stream: bool = True,
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
            extra_model_kwargs['stop'] = stop

        client = ZhipuAI(
            api_key=credentials_kwargs['api_key']
        )

        if len(prompt_messages) == 0:
            raise ValueError('At least one message is required')

        if prompt_messages[0].role == PromptMessageRole.SYSTEM:
            if not prompt_messages[0].content:
                prompt_messages = prompt_messages[1:]

        # resolve zhipuai model not support system message and user message, assistant message must be in sequence
        new_prompt_messages: list[PromptMessage] = []
        for prompt_message in prompt_messages:
            copy_prompt_message = prompt_message.copy()
            if copy_prompt_message.role in [PromptMessageRole.USER, PromptMessageRole.SYSTEM, PromptMessageRole.TOOL]:
                if isinstance(copy_prompt_message.content, list):
                    # check if model is 'glm-4v'
                    if model != 'glm-4v':
                        # not support list message
                        continue
                    # get image and 
                    if not isinstance(copy_prompt_message, UserPromptMessage):
                        # not support system message
                        continue
                    new_prompt_messages.append(copy_prompt_message)

                if not isinstance(copy_prompt_message.content, str):
                    # not support image message
                    continue

                if new_prompt_messages and new_prompt_messages[-1].role == PromptMessageRole.USER and \
                        copy_prompt_message.role == PromptMessageRole.USER:
                    new_prompt_messages[-1].content += "\n\n" + copy_prompt_message.content
                else:
                    if copy_prompt_message.role == PromptMessageRole.USER:
                        new_prompt_messages.append(copy_prompt_message)
                    elif copy_prompt_message.role == PromptMessageRole.TOOL:
                        new_prompt_messages.append(copy_prompt_message)
                    elif copy_prompt_message.role == PromptMessageRole.SYSTEM:
                        new_prompt_message = SystemPromptMessage(content=copy_prompt_message.content)
                        new_prompt_messages.append(new_prompt_message)
                    else:
                        new_prompt_message = UserPromptMessage(content=copy_prompt_message.content)
                        new_prompt_messages.append(new_prompt_message)
            else:
                if new_prompt_messages and new_prompt_messages[-1].role == PromptMessageRole.ASSISTANT:
                    new_prompt_messages[-1].content += "\n\n" + copy_prompt_message.content
                else:
                    new_prompt_messages.append(copy_prompt_message)

        if model == 'glm-4v':
            params = self._construct_glm_4v_parameter(model, new_prompt_messages, model_parameters)
        else:
            params = {
                'model': model,
                'messages': [],
                **model_parameters
            }
            # glm model
            if not model.startswith('chatglm'):

                for prompt_message in new_prompt_messages:
                    if prompt_message.role == PromptMessageRole.TOOL:
                        params['messages'].append({
                            'role': 'tool',
                            'content': prompt_message.content,
                            'tool_call_id': prompt_message.tool_call_id
                        })
                    elif isinstance(prompt_message, AssistantPromptMessage):
                        if prompt_message.tool_calls:
                            params['messages'].append({
                                'role': 'assistant',
                                'content': prompt_message.content,
                                'tool_calls': [
                                    {
                                        'id': tool_call.id,
                                        'type': tool_call.type,
                                        'function': {
                                            'name': tool_call.function.name,
                                            'arguments': tool_call.function.arguments
                                        }
                                    } for tool_call in prompt_message.tool_calls
                                ]
                            })
                        else:
                            params['messages'].append({
                                'role': 'assistant',
                                'content': prompt_message.content
                            })
                    else:
                        params['messages'].append({
                            'role': prompt_message.role.value,
                            'content': prompt_message.content
                        })
            else:
                # chatglm model
                for prompt_message in new_prompt_messages:
                    # merge system message to user message
                    if prompt_message.role == PromptMessageRole.SYSTEM or \
                            prompt_message.role == PromptMessageRole.TOOL or \
                            prompt_message.role == PromptMessageRole.USER:
                        if len(params['messages']) > 0 and params['messages'][-1]['role'] == 'user':
                            params['messages'][-1]['content'] += "\n\n" + prompt_message.content
                        else:
                            params['messages'].append({
                                'role': 'user',
                                'content': prompt_message.content
                            })
                    else:
                        params['messages'].append({
                            'role': prompt_message.role.value,
                            'content': prompt_message.content
                        })

        if tools and len(tools) > 0:
            params['tools'] = [
                {
                    'type': 'function',
                    'function': helper.dump_model(tool)
                } for tool in tools
            ]

        if stream:
            response = client.chat.completions.create(stream=stream, **params, **extra_model_kwargs)
            return self._handle_generate_stream_response(model, credentials_kwargs, tools, response, prompt_messages)

        response = client.chat.completions.create(**params, **extra_model_kwargs)
        return self._handle_generate_response(model, credentials_kwargs, tools, response, prompt_messages)

    def _construct_glm_4v_parameter(self, model: str, prompt_messages: list[PromptMessage],
                                    model_parameters: dict):
        messages = [
            {
                'role': message.role.value,
                'content': self._construct_glm_4v_messages(message.content)
            }
            for message in prompt_messages
        ]

        params = {
            'model': model,
            'messages': messages,
            **model_parameters
        }

        return params

    def _construct_glm_4v_messages(self, prompt_message: Union[str | list[PromptMessageContent]]) -> list[dict]:
        if isinstance(prompt_message, str):
            return [{'type': 'text', 'text': prompt_message}]

        return [
            {'type': 'image_url', 'image_url': {'url': self._remove_image_header(item.data)}}
            if item.type == PromptMessageContentType.IMAGE else
            {'type': 'text', 'text': item.data}

            for item in prompt_message
        ]

    def _remove_image_header(self, image: str) -> str:
        if image.startswith('data:image'):
            return image.split(',')[1]

        return image

    def _handle_generate_response(self, model: str,
                                  credentials: dict,
                                  tools: Optional[list[PromptMessageTool]],
                                  response: Completion,
                                  prompt_messages: list[PromptMessage]) -> LLMResult:
        """
        Handle llm response

        :param model: model name
        :param response: response
        :param prompt_messages: prompt messages
        :return: llm response
        """
        text = ''
        assistant_tool_calls: list[AssistantPromptMessage.ToolCall] = []
        for choice in response.choices:
            if choice.message.tool_calls:
                for tool_call in choice.message.tool_calls:
                    if tool_call.type == 'function':
                        assistant_tool_calls.append(
                            AssistantPromptMessage.ToolCall(
                                id=tool_call.id,
                                type=tool_call.type,
                                function=AssistantPromptMessage.ToolCall.ToolCallFunction(
                                    name=tool_call.function.name,
                                    arguments=tool_call.function.arguments,
                                )
                            )
                        )

            text += choice.message.content or ''

        prompt_usage = response.usage.prompt_tokens
        completion_usage = response.usage.completion_tokens

        # transform usage
        usage = self._calc_response_usage(model, credentials, prompt_usage, completion_usage)

        # transform response
        result = LLMResult(
            model=model,
            prompt_messages=prompt_messages,
            message=AssistantPromptMessage(
                content=text,
                tool_calls=assistant_tool_calls
            ),
            usage=usage,
        )

        return result

    def _handle_generate_stream_response(self, model: str,
                                         credentials: dict,
                                         tools: Optional[list[PromptMessageTool]],
                                         responses: Generator[ChatCompletionChunk, None, None],
                                         prompt_messages: list[PromptMessage]) -> Generator:
        """
        Handle llm stream response

        :param model: model name
        :param response: response
        :param prompt_messages: prompt messages
        :return: llm response chunk generator result
        """
        full_assistant_content = ''
        for chunk in responses:
            if len(chunk.choices) == 0:
                continue

            delta = chunk.choices[0]

            if delta.finish_reason is None and (delta.delta.content is None or delta.delta.content == ''):
                continue

            assistant_tool_calls: list[AssistantPromptMessage.ToolCall] = []
            for tool_call in delta.delta.tool_calls or []:
                if tool_call.type == 'function':
                    assistant_tool_calls.append(
                        AssistantPromptMessage.ToolCall(
                            id=tool_call.id,
                            type=tool_call.type,
                            function=AssistantPromptMessage.ToolCall.ToolCallFunction(
                                name=tool_call.function.name,
                                arguments=tool_call.function.arguments,
                            )
                        )
                    )

            # transform assistant message to prompt message
            assistant_prompt_message = AssistantPromptMessage(
                content=delta.delta.content if delta.delta.content else '',
                tool_calls=assistant_tool_calls
            )

            full_assistant_content += delta.delta.content if delta.delta.content else ''

            if delta.finish_reason is not None and chunk.usage is not None:
                completion_tokens = chunk.usage.completion_tokens
                prompt_tokens = chunk.usage.prompt_tokens

                # transform usage
                usage = self._calc_response_usage(model, credentials, prompt_tokens, completion_tokens)

                yield LLMResultChunk(
                    model=chunk.model,
                    prompt_messages=prompt_messages,
                    system_fingerprint='',
                    delta=LLMResultChunkDelta(
                        index=delta.index,
                        message=assistant_prompt_message,
                        finish_reason=delta.finish_reason,
                        usage=usage
                    )
                )
            else:
                yield LLMResultChunk(
                    model=chunk.model,
                    prompt_messages=prompt_messages,
                    system_fingerprint='',
                    delta=LLMResultChunkDelta(
                        index=delta.index,
                        message=assistant_prompt_message,
                        finish_reason=delta.finish_reason
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
        elif isinstance(message, ToolPromptMessage):
            message_text = content
        else:
            raise ValueError(f"Got unknown type {message}")

        return message_text

    def _convert_messages_to_prompt(self, messages: list[PromptMessage],
                                    tools: Optional[list[PromptMessageTool]] = None) -> str:
        """
        :param messages: List of PromptMessage to combine.
        :return: Combined string with necessary human_prompt and ai_prompt tags.
        """
        messages = messages.copy()  # don't mutate the original list

        text = "".join(
            self._convert_one_message_to_text(message)
            for message in messages
        )

        if tools and len(tools) > 0:
            text += "\n\nTools:"
            for tool in tools:
                text += f"\n{tool.json()}"

        # trim off the trailing ' ' that might come from the "Assistant: "
        return text.rstrip()
