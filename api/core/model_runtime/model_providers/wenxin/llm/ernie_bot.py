from collections.abc import Generator
from datetime import datetime, timedelta
from enum import Enum
from json import dumps, loads
from threading import Lock
from typing import Any, Union

from requests import Response, post

from core.model_runtime.entities.message_entities import PromptMessageTool
from core.model_runtime.model_providers.wenxin.llm.ernie_bot_errors import (
    BadRequestError,
    InternalServerError,
    InvalidAPIKeyError,
    InvalidAuthenticationError,
    RateLimitReachedError,
)

# map api_key to access_token
baidu_access_tokens: dict[str, 'BaiduAccessToken'] = {}
baidu_access_tokens_lock = Lock()

class BaiduAccessToken:
    api_key: str
    access_token: str
    expires: datetime

    def __init__(self, api_key: str) -> None:
        self.api_key = api_key
        self.access_token = ''
        self.expires = datetime.now() + timedelta(days=3)

    def _get_access_token(api_key: str, secret_key: str) -> str:
        """
            request access token from Baidu
        """
        try:
            response = post(
                url=f'https://aip.baidubce.com/oauth/2.0/token?grant_type=client_credentials&client_id={api_key}&client_secret={secret_key}',
                headers={
                    'Content-Type': 'application/json',
                    'Accept': 'application/json'
                },
            )
        except Exception as e:
            raise InvalidAuthenticationError(f'Failed to get access token from Baidu: {e}')

        resp = response.json()
        if 'error' in resp:
            if resp['error'] == 'invalid_client':
                raise InvalidAPIKeyError(f'Invalid API key or secret key: {resp["error_description"]}')
            elif resp['error'] == 'unknown_error':
                raise InternalServerError(f'Internal server error: {resp["error_description"]}')
            elif resp['error'] == 'invalid_request':
                raise BadRequestError(f'Bad request: {resp["error_description"]}')
            elif resp['error'] == 'rate_limit_exceeded':
                raise RateLimitReachedError(f'Rate limit reached: {resp["error_description"]}')
            else:
                raise Exception(f'Unknown error: {resp["error_description"]}')

        return resp['access_token']

    @staticmethod
    def get_access_token(api_key: str, secret_key: str) -> 'BaiduAccessToken':
        """
            LLM from Baidu requires access token to invoke the API.
            however, we have api_key and secret_key, and access token is valid for 30 days.
            so we can cache the access token for 3 days. (avoid memory leak)

            it may be more efficient to use a ticker to refresh access token, but it will cause
            more complexity, so we just refresh access tokens when get_access_token is called.
        """

        # loop up cache, remove expired access token
        baidu_access_tokens_lock.acquire()
        now = datetime.now()
        for key in list(baidu_access_tokens.keys()):
            token = baidu_access_tokens[key]
            if token.expires < now:
                baidu_access_tokens.pop(key)

        if api_key not in baidu_access_tokens:
            # if access token not in cache, request it
            token = BaiduAccessToken(api_key)
            baidu_access_tokens[api_key] = token
            # release it to enhance performance
            # btw, _get_access_token will raise exception if failed, release lock here to avoid deadlock
            baidu_access_tokens_lock.release()
            # try to get access token
            token_str = BaiduAccessToken._get_access_token(api_key, secret_key)
            token.access_token = token_str
            token.expires = now + timedelta(days=3)
            return token
        else:
            # if access token in cache, return it
            token = baidu_access_tokens[api_key]
            baidu_access_tokens_lock.release()
            return token


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

class ErnieBotModel:
    api_bases = {
        'ernie-bot': 'https://aip.baidubce.com/rpc/2.0/ai_custom/v1/wenxinworkshop/chat/ernie-3.5-4k-0205',
        'ernie-bot-4': 'https://aip.baidubce.com/rpc/2.0/ai_custom/v1/wenxinworkshop/chat/completions_pro',
        'ernie-bot-8k': 'https://aip.baidubce.com/rpc/2.0/ai_custom/v1/wenxinworkshop/chat/completions',
        'ernie-bot-turbo': 'https://aip.baidubce.com/rpc/2.0/ai_custom/v1/wenxinworkshop/chat/eb-instant',
        'ernie-3.5-8k': 'https://aip.baidubce.com/rpc/2.0/ai_custom/v1/wenxinworkshop/chat/completions',
        'ernie-3.5-8k-0205': 'https://aip.baidubce.com/rpc/2.0/ai_custom/v1/wenxinworkshop/chat/ernie-3.5-8k-0205',
        'ernie-3.5-8k-1222': 'https://aip.baidubce.com/rpc/2.0/ai_custom/v1/wenxinworkshop/chat/ernie-3.5-8k-1222',
        'ernie-3.5-4k-0205': 'https://aip.baidubce.com/rpc/2.0/ai_custom/v1/wenxinworkshop/chat/ernie-3.5-4k-0205',
        'ernie-3.5-128k': 'https://aip.baidubce.com/rpc/2.0/ai_custom/v1/wenxinworkshop/chat/ernie-3.5-128k',
        'ernie-4.0-8k': 'https://aip.baidubce.com/rpc/2.0/ai_custom/v1/wenxinworkshop/chat/completions_pro',
        'ernie-4.0-8k-latest': 'https://aip.baidubce.com/rpc/2.0/ai_custom/v1/wenxinworkshop/chat/completions_pro',
        'ernie-speed-8k': 'https://aip.baidubce.com/rpc/2.0/ai_custom/v1/wenxinworkshop/chat/ernie_speed',
        'ernie-speed-128k': 'https://aip.baidubce.com/rpc/2.0/ai_custom/v1/wenxinworkshop/chat/ernie-speed-128k',
        'ernie-speed-appbuilder': 'https://aip.baidubce.com/rpc/2.0/ai_custom/v1/wenxinworkshop/chat/ai_apaas',
        'ernie-lite-8k-0922': 'https://aip.baidubce.com/rpc/2.0/ai_custom/v1/wenxinworkshop/chat/eb-instant',
        'ernie-lite-8k-0308': 'https://aip.baidubce.com/rpc/2.0/ai_custom/v1/wenxinworkshop/chat/ernie-lite-8k',
        'ernie-character-8k': 'https://aip.baidubce.com/rpc/2.0/ai_custom/v1/wenxinworkshop/chat/ernie-char-8k',
        'ernie-character-8k-0321': 'https://aip.baidubce.com/rpc/2.0/ai_custom/v1/wenxinworkshop/chat/ernie-char-8k',
        'ernie-4.0-tutbo-8k': 'https://aip.baidubce.com/rpc/2.0/ai_custom/v1/wenxinworkshop/chat/ernie-4.0-turbo-8k',
        'ernie-4.0-tutbo-8k-preview': 'https://aip.baidubce.com/rpc/2.0/ai_custom/v1/wenxinworkshop/chat/ernie-4.0-turbo-8k-preview',
    }

    function_calling_supports = [
        'ernie-bot',
        'ernie-bot-8k',
        'ernie-3.5-8k',
        'ernie-3.5-8k-0205',
        'ernie-3.5-8k-1222',
        'ernie-3.5-4k-0205',
        'ernie-3.5-128k',
        'ernie-4.0-8k',
        'ernie-4.0-turbo-8k',
        'ernie-4.0-turbo-8k-preview'
    ]

    api_key: str = ''
    secret_key: str = ''

    def __init__(self, api_key: str, secret_key: str):
        self.api_key = api_key
        self.secret_key = secret_key

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

    def _handle_error(self, code: int, msg: str):
        error_map = {
            1: InternalServerError,
            2: InternalServerError,
            3: BadRequestError,
            4: RateLimitReachedError,
            6: InvalidAuthenticationError,
            13: InvalidAPIKeyError,
            14: InvalidAPIKeyError,
            15: InvalidAPIKeyError,
            17: RateLimitReachedError,
            18: RateLimitReachedError,
            19: RateLimitReachedError,
            100: InvalidAPIKeyError,
            111: InvalidAPIKeyError,
            200: InternalServerError,
            336000: InternalServerError,
            336001: BadRequestError,
            336002: BadRequestError,
            336003: BadRequestError,
            336004: InvalidAuthenticationError,
            336005: InvalidAPIKeyError,
            336006: BadRequestError,
            336007: BadRequestError,
            336008: BadRequestError,
            336100: InternalServerError,
            336101: BadRequestError,
            336102: BadRequestError,
            336103: BadRequestError,
            336104: BadRequestError,
            336105: BadRequestError,
            336200: InternalServerError,
            336303: BadRequestError,
            337006: BadRequestError
        }

        if code in error_map:
            raise error_map[code](msg)
        else:
            raise InternalServerError(f'Unknown error: {msg}')

    def _get_access_token(self) -> str:
        token = BaiduAccessToken.get_access_token(self.api_key, self.secret_key)
        return token.access_token

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
