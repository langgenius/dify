from enum import Enum
from hashlib import md5
from json import dumps, loads
from os.path import join
from time import time
from typing import Any, Dict, Generator, List, Optional, Union

from core.model_runtime.model_providers.baichuan.llm.baichuan_turbo_errors import (BadRequestError,
                                                                                   InsufficientAccountBalance,
                                                                                   InternalServerError,
                                                                                   InvalidAPIKeyError,
                                                                                   InvalidAuthenticationError,
                                                                                   RateLimitReachedError)
from requests import post


class BaichuanMessage:
    class Role(Enum):
        USER = 'user'
        ASSISTANT = 'assistant'
        # Baichuan does not have system message
        _SYSTEM = 'system'

    role: str = Role.USER.value
    content: str
    usage: Dict[str, int] = None
    stop_reason: str = ''

    def to_dict(self) -> Dict[str, Any]:
        return {
            'role': self.role,
            'content': self.content,
        }
    
    def __init__(self, content: str, role: str = 'user') -> None:
        self.content = content
        self.role = role

class BaichuanModel(object):
    api_key: str
    secret_key: str

    def __init__(self, api_key: str, secret_key: str = '') -> None:
        self.api_key = api_key
        self.secret_key = secret_key

    def _model_mapping(self, model: str) -> str:
        return {
            'baichuan2-turbo': 'Baichuan2-Turbo',
            'baichuan2-turbo-192k': 'Baichuan2-Turbo-192k',
            'baichuan2-53b': 'Baichuan2-53B',
        }[model]

    def _handle_chat_generate_response(self, response) -> BaichuanMessage:
            resp = response.json()
            choices = resp.get('choices', [])
            message = BaichuanMessage(content='', role='assistant')
            for choice in choices:
                message.content += choice['message']['content']
                message.role = choice['message']['role']
                if choice['finish_reason']:
                    message.stop_reason = choice['finish_reason']

            if 'usage' in resp:
                message.usage = {
                    'prompt_tokens': resp['usage']['prompt_tokens'],
                    'completion_tokens': resp['usage']['completion_tokens'],
                    'total_tokens': resp['usage']['total_tokens'],
                }
            
            return message
    
    def _handle_chat_stream_generate_response(self, response) -> Generator:
        for line in response.iter_lines():
            if not line:
                continue
            line = line.decode('utf-8')
            # remove the first `data: ` prefix
            if line.startswith('data:'):
                line = line[5:].strip()
            try:
                data = loads(line)
            except Exception as e:
                if line.strip() == '[DONE]':
                    return
            choices = data.get('choices', [])
            # save stop reason temporarily
            stop_reason = ''
            for choice in choices:
                if 'finish_reason' in choice and choice['finish_reason']:
                    stop_reason = choice['finish_reason']

                if len(choice['delta']['content']) == 0:
                    continue
                yield BaichuanMessage(**choice['delta'])

            # if there is usage, the response is the last one, yield it and return
            if 'usage' in data:
                message = BaichuanMessage(content='', role='assistant')
                message.usage = {
                    'prompt_tokens': data['usage']['prompt_tokens'],
                    'completion_tokens': data['usage']['completion_tokens'],
                    'total_tokens': data['usage']['total_tokens'],
                }
                message.stop_reason = stop_reason
                yield message

    def _build_parameters(self, model: str, stream: bool, messages: List[BaichuanMessage],
                               parameters: Dict[str, Any]) \
        -> Dict[str, Any]:
        if model == 'baichuan2-turbo' or model == 'baichuan2-turbo-192k' or model == 'baichuan2-53b':
            prompt_messages = []
            for message in messages:
                if message.role == BaichuanMessage.Role.USER.value or message.role == BaichuanMessage.Role._SYSTEM.value:
                    # check if the latest message is a user message
                    if len(prompt_messages) > 0 and prompt_messages[-1]['role'] == BaichuanMessage.Role.USER.value:
                        prompt_messages[-1]['content'] += message.content
                    else:
                        prompt_messages.append({
                            'content': message.content,
                            'role': BaichuanMessage.Role.USER.value,
                        })
                elif message.role == BaichuanMessage.Role.ASSISTANT.value:
                    prompt_messages.append({
                        'content': message.content,
                        'role': message.role,
                    })
            # [baichuan] frequency_penalty must be between 1 and 2
            if parameters['frequency_penalty'] < 1 or parameters['frequency_penalty'] > 2:
                parameters['frequency_penalty'] = 1
            # turbo api accepts flat parameters
            return {
                'model': self._model_mapping(model),
                'stream': stream,
                'messages': prompt_messages,
                **parameters,
            }
        else:
            raise BadRequestError(f"Unknown model: {model}")
        
    def _build_headers(self, model: str, data: Dict[str, Any]) -> Dict[str, Any]:
        if model == 'baichuan2-turbo' or model == 'baichuan2-turbo-192k' or model == 'baichuan2-53b':
            # there is no secret key for turbo api
            return {
                'Content-Type': 'application/json',
                'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) ',
                'Authorization': 'Bearer ' + self.api_key,
            }
        else:
            raise BadRequestError(f"Unknown model: {model}")
        
    def _calculate_md5(self, input_string):
        return md5(input_string.encode('utf-8')).hexdigest()

    def generate(self, model: str, stream: bool, messages: List[BaichuanMessage], 
                 parameters: Dict[str, Any], timeout: int) \
        -> Union[Generator, BaichuanMessage]:
        
        if model == 'baichuan2-turbo' or model == 'baichuan2-turbo-192k' or model == 'baichuan2-53b':
            api_base = 'https://api.baichuan-ai.com/v1/chat/completions'
        else:
            raise BadRequestError(f"Unknown model: {model}")
        
        try:
            data = self._build_parameters(model, stream, messages, parameters)
            headers = self._build_headers(model, data)
        except KeyError:
            raise InternalServerError(f"Failed to build parameters for model: {model}")

        try:
            response = post(
                url=api_base,
                headers=headers,
                data=dumps(data),
                timeout=timeout,
                stream=stream
            )
        except Exception as e:
            raise InternalServerError(f"Failed to invoke model: {e}")
        
        if response.status_code != 200:
            try:
                resp = response.json()
                # try to parse error message
                err = resp['error']['code']
                msg = resp['error']['message']
            except Exception as e:
                raise InternalServerError(f"Failed to convert response to json: {e} with text: {response.text}")

            if err == 'invalid_api_key':
                raise InvalidAPIKeyError(msg)
            elif err == 'insufficient_quota':
                raise InsufficientAccountBalance(msg)
            elif err == 'invalid_authentication':
                raise InvalidAuthenticationError(msg)
            elif 'rate' in err:
                raise RateLimitReachedError(msg)
            elif 'internal' in err:
                raise InternalServerError(msg)
            elif err == 'api_key_empty':
                raise InvalidAPIKeyError(msg)
            else:
                raise InternalServerError(f"Unknown error: {err} with message: {msg}")
            
        if stream:
            return self._handle_chat_stream_generate_response(response)
        else:
            return self._handle_chat_generate_response(response)