from enum import Enum
from json import dumps, loads
from typing import Any, Dict, Generator, List, Union

from core.model_runtime.model_providers.openllm.llm.openllm_generate_errors import (BadRequestError,
                                                                                    InsufficientAccountBalanceError,
                                                                                    InternalServerError,
                                                                                    InvalidAPIKeyError,
                                                                                    InvalidAuthenticationError,
                                                                                    RateLimitReachedError)
from requests import Response, post
from requests.exceptions import ConnectionError, InvalidSchema, MissingSchema


class OpenLLMGenerateMessage:
    class Role(Enum):
        USER = 'user'
        ASSISTANT = 'assistant'

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


class OpenLLMGenerate(object):
    def generate(
            self, server_url: str, model_name: str, stream: bool, model_parameters: Dict[str, Any],
            stop: List[str], prompt_messages: List[OpenLLMGenerateMessage], user: str,
    ) -> Union[Generator[OpenLLMGenerateMessage, None, None], OpenLLMGenerateMessage]:
        if not server_url:
            raise InvalidAuthenticationError('Invalid server URL')

        default_llm_config = {
            "max_new_tokens": 128,
            "min_length": 0,
            "early_stopping": False,
            "num_beams": 1,
            "num_beam_groups": 1,
            "use_cache": True,
            "temperature": 0.75,
            "top_k": 15,
            "top_p": 0.9,
            "typical_p": 1,
            "epsilon_cutoff": 0,
            "eta_cutoff": 0,
            "diversity_penalty": 0,
            "repetition_penalty": 1,
            "encoder_repetition_penalty": 1,
            "length_penalty": 1,
            "no_repeat_ngram_size": 0,
            "renormalize_logits": False,
            "remove_invalid_values": False,
            "num_return_sequences": 1,
            "output_attentions": False,
            "output_hidden_states": False,
            "output_scores": False,
            "encoder_no_repeat_ngram_size": 0,
            "n": 1,
            "presence_penalty": 0,
            "frequency_penalty": 0,
            "use_beam_search": False,
            "ignore_eos": False,
            "skip_special_tokens": True
        }

        if 'max_tokens' in model_parameters and type(model_parameters['max_tokens']) == int:
            default_llm_config['max_new_tokens'] = model_parameters['max_tokens']

        if 'temperature' in model_parameters and type(model_parameters['temperature']) == float:
            default_llm_config['temperature'] = model_parameters['temperature']

        if 'top_p' in model_parameters and type(model_parameters['top_p']) == float:
            default_llm_config['top_p'] = model_parameters['top_p']

        if 'top_k' in model_parameters and type(model_parameters['top_k']) == int:
            default_llm_config['top_k'] = model_parameters['top_k']

        if 'use_cache' in model_parameters and type(model_parameters['use_cache']) == bool:
            default_llm_config['use_cache'] = model_parameters['use_cache']

        headers = {
            'Content-Type': 'application/json',
            'accept': 'application/json'
        }

        if stream:
            url = f'{server_url}/v1/generate_stream'
            timeout = 10
        else:
            url = f'{server_url}/v1/generate'
            timeout = 120

        data = {
            'stop': stop if stop else [],
            'prompt': '\n'.join([message.content for message in prompt_messages]),
            'llm_config': default_llm_config,
        }

        try:
            response = post(url=url, data=dumps(data), timeout=timeout, stream=stream, headers=headers)
        except (ConnectionError, InvalidSchema, MissingSchema) as e:
            # cloud not connect to the server
            raise InvalidAuthenticationError(f"Invalid server URL: {e}")
        
        if not response.ok:
            resp = response.json()
            msg = resp['msg']
            if response.status_code == 400:
                raise BadRequestError(msg)
            elif response.status_code == 404:
                raise InvalidAuthenticationError(msg)
            elif response.status_code == 500:
                raise InternalServerError(msg)
            else:
                raise InternalServerError(msg)
            
        if stream:
            return self._handle_chat_stream_generate_response(response)
        return self._handle_chat_generate_response(response)
        
    def _handle_chat_generate_response(self, response: Response) -> OpenLLMGenerateMessage:
        try:
            data = response.json()
        except Exception as e:
            raise InternalServerError(f"Failed to convert response to json: {e} with text: {response.text}")

        message = data['outputs'][0]
        text = message['text']
        token_ids = message['token_ids']
        prompt_token_ids = data['prompt_token_ids']
        stop_reason = message['finish_reason']

        message = OpenLLMGenerateMessage(content=text, role=OpenLLMGenerateMessage.Role.ASSISTANT.value)
        message.stop_reason = stop_reason
        message.usage = {
            'prompt_tokens': len(prompt_token_ids),
            'completion_tokens': len(token_ids),
            'total_tokens': len(prompt_token_ids) + len(token_ids),
        }

        return message

    def _handle_chat_stream_generate_response(self, response: Response) -> Generator[OpenLLMGenerateMessage, None, None]:
        completion_usage = 0

        for line in response.iter_lines():
            if not line:
                continue

            line: str = line.decode('utf-8')
            if line.startswith('data: '):
                line = line[6:].strip()

            if line == '[DONE]':
                return

            try:
                data = loads(line)
            except Exception as e:
                raise InternalServerError(f"Failed to convert response to json: {e} with text: {line}")
            
            output = data['outputs']

            for choice in output:
                text = choice['text']
                token_ids = choice['token_ids']

                completion_usage += len(token_ids)
                message = OpenLLMGenerateMessage(content=text, role=OpenLLMGenerateMessage.Role.ASSISTANT.value)

                if 'finish_reason' in choice and choice['finish_reason']:
                    finish_reason = choice['finish_reason']
                    prompt_token_ids = data['prompt_token_ids']
                    message.stop_reason = finish_reason
                    message.usage = {
                        'prompt_tokens': len(prompt_token_ids),
                        'completion_tokens': completion_usage,
                        'total_tokens': completion_usage + len(prompt_token_ids),
                    }
                    
                yield message