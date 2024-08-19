from collections.abc import Generator
from enum import Enum
from json import dumps, loads
from typing import Any, Union

from requests import Response, post

from core.model_runtime.entities.message_entities import PromptMessageTool
from core.model_runtime.model_providers.wenxin._common import _CommonWenxin
from core.model_runtime.model_providers.wenxin.wenxin_errors import (
    BadRequestError,
    InternalServerError,
)


class ErnieMessage:
    class Role(Enum):
        USER = 'user'
        ASSISTANT = 'assistant'
        FUNCTION = 'function'
        SYSTEM = 'system'

    role: str = Role.USER.value
    content: str
    usage: dict[str, int] = None
    stop_reason: str = ''

    def to_dict(self) -> dict[str, Any]:
        return {
            'role': self.role,
            'content': self.content,
        }

    def __init__(self, content: str, role: str = 'user') -> None:
        self.content = content
        self.role = role

class ErnieBotModel(_CommonWenxin):

    def generate(self, model: str, stream: bool, messages: list[ErnieMessage],
                 parameters: dict[str, Any], timeout: int, tools: list[PromptMessageTool], \
                 stop: list[str], user: str) \
        -> Union[Generator[ErnieMessage, None, None], ErnieMessage]:

        # check parameters
        self._check_parameters(model, parameters, tools, stop)

        # get access token
        access_token = self._get_access_token()

        # generate request body
        url = f'{self.api_bases[model]}?access_token={access_token}'

        # clone messages
        messages_cloned = self._copy_messages(messages=messages)

        # build body
        body = self._build_request_body(model, messages=messages_cloned, stream=stream,
                                        parameters=parameters, tools=tools, stop=stop, user=user)
        headers = {
            'Content-Type': 'application/json',
        }

        resp = post(url=url, data=dumps(body), headers=headers, stream=stream)

        if resp.status_code != 200:
            raise InternalServerError(f'Failed to invoke ernie bot: {resp.text}')

        if stream:
            return self._handle_chat_stream_generate_response(resp)
        return self._handle_chat_generate_response(resp)

    def _copy_messages(self, messages: list[ErnieMessage]) -> list[ErnieMessage]:
        return [ErnieMessage(message.content, message.role) for message in messages]

    def _check_parameters(self, model: str, parameters: dict[str, Any],
                          tools: list[PromptMessageTool], stop: list[str]) -> None:
        if model not in self.api_bases:
            raise BadRequestError(f'Invalid model: {model}')

        # if model not in self.function_calling_supports and tools is not None and len(tools) > 0:
        #     raise BadRequestError(f'Model {model} does not support calling function.')
        # ErnieBot supports function calling, however, there is lots of limitations.
        # such as, the messages should be ordered as user by assistant or function...
        # so, we just disable function calling for now.

        if tools is not None and len(tools) > 0:
            raise BadRequestError('function calling is not supported yet.')

        if stop is not None:
            if len(stop) > 4:
                raise BadRequestError('stop list should not exceed 4 items.')

            for s in stop:
                if len(s) > 20:
                    raise BadRequestError('stop item should not exceed 20 characters.')

    def _build_request_body(self, model: str, messages: list[ErnieMessage], stream: bool, parameters: dict[str, Any],
                            tools: list[PromptMessageTool], stop: list[str], user: str) -> dict[str, Any]:
        # if model in self.function_calling_supports:
        #     return self._build_function_calling_request_body(model, messages, parameters, tools, stop, user)
        return self._build_chat_request_body(model, messages, stream, parameters, stop, user)

    def _build_function_calling_request_body(self, model: str, messages: list[ErnieMessage], stream: bool,
                                                parameters: dict[str, Any], tools: list[PromptMessageTool],
                                                stop: list[str], user: str) \
        -> dict[str, Any]:
        if len(messages) % 2 == 0:
            raise BadRequestError('The number of messages should be odd.')
        if messages[0].role == 'function':
            raise BadRequestError('The first message should be user message.')

        """
        TODO: implement function calling
        """

    def _build_chat_request_body(self, model: str, messages: list[ErnieMessage], stream: bool,
                                 parameters: dict[str, Any], stop: list[str], user: str) \
        -> dict[str, Any]:
        if len(messages) == 0:
            raise BadRequestError('The number of messages should not be zero.')

        # check if the first element is system, shift it
        system_message = ''
        if messages[0].role == 'system':
            message = messages.pop(0)
            system_message = message.content

        if len(messages) % 2 == 0:
            raise BadRequestError('The number of messages should be odd.')
        if messages[0].role != 'user':
            raise BadRequestError('The first message should be user message.')
        body = {
            'messages': [message.to_dict() for message in messages],
            'stream': stream,
            'stop': stop,
            'user_id': user,
            **parameters
        }

        if 'max_tokens' in parameters and type(parameters['max_tokens']) == int:
            body['max_output_tokens'] = parameters['max_tokens']

        if 'presence_penalty' in parameters and type(parameters['presence_penalty']) == float:
            body['penalty_score'] = parameters['presence_penalty']

        if system_message:
            body['system'] = system_message

        return body

    def _handle_chat_generate_response(self, response: Response) -> ErnieMessage:
        data = response.json()
        if 'error_code' in data:
            code = data['error_code']
            msg = data['error_msg']
            # raise error
            self._handle_error(code, msg)

        result = data['result']
        usage = data['usage']

        message = ErnieMessage(content=result, role='assistant')
        message.usage = {
            'prompt_tokens': usage['prompt_tokens'],
            'completion_tokens': usage['completion_tokens'],
            'total_tokens': usage['total_tokens']
        }

        return message

    def _handle_chat_stream_generate_response(self, response: Response) -> Generator[ErnieMessage, None, None]:
        for line in response.iter_lines():
            if len(line) == 0:
                continue
            line = line.decode('utf-8')
            if line[0] == '{':
                try:
                    data = loads(line)
                    if 'error_code' in data:
                        code = data['error_code']
                        msg = data['error_msg']
                        # raise error
                        self._handle_error(code, msg)
                except Exception as e:
                    raise InternalServerError(f'Failed to parse response: {e}')

            if line.startswith('data:'):
                line = line[5:].strip()
            else:
                continue

            if not line:
                continue
            try:
                data = loads(line)
            except Exception as e:
                raise InternalServerError(f'Failed to parse response: {e}')

            result = data['result']
            is_end = data['is_end']

            if is_end:
                usage = data['usage']
                finish_reason = data.get('finish_reason', None)
                message = ErnieMessage(content=result, role='assistant')
                message.usage = {
                    'prompt_tokens': usage['prompt_tokens'],
                    'completion_tokens': usage['completion_tokens'],
                    'total_tokens': usage['total_tokens']
                }
                message.stop_reason = finish_reason

                yield message
            else:
                message = ErnieMessage(content=result, role='assistant')
                yield message
