"""Wrapper around Wenxin APIs."""
from __future__ import annotations

import json
import logging
from json import JSONDecodeError
from typing import (
    Any,
    Dict,
    List,
    Optional, Iterator, Tuple,
)

import requests
from langchain.chat_models.base import BaseChatModel
from langchain.llms.utils import enforce_stop_tokens
from langchain.schema import BaseMessage, ChatMessage, HumanMessage, AIMessage, SystemMessage
from langchain.schema.messages import AIMessageChunk
from langchain.schema.output import GenerationChunk, ChatResult, ChatGenerationChunk, ChatGeneration
from pydantic import BaseModel, Extra, Field, PrivateAttr, root_validator

from langchain.callbacks.manager import (
    CallbackManagerForLLMRun,
)
from langchain.llms.base import LLM
from langchain.utils import get_from_dict_or_env

logger = logging.getLogger(__name__)


class _WenxinEndpointClient(BaseModel):
    """An API client that talks to a Wenxin llm endpoint."""

    base_url: str = "https://aip.baidubce.com/rpc/2.0/ai_custom/v1/wenxinworkshop/chat/"
    secret_key: str
    api_key: str

    def get_access_token(self) -> str:
        url = f"https://aip.baidubce.com/oauth/2.0/token?client_id={self.api_key}" \
              f"&client_secret={self.secret_key}&grant_type=client_credentials"

        headers = {
            'Content-Type': 'application/json',
            'Accept': 'application/json'
        }

        response = requests.post(url, headers=headers)
        if not response.ok:
            raise ValueError(f"Wenxin HTTP {response.status_code} error: {response.text}")
        if 'error' in response.json():
            raise ValueError(
                f"Wenxin API {response.json()['error']}"
                f" error: {response.json()['error_description']}"
            )

        access_token = response.json()['access_token']

        # todo add cache

        return access_token

    def post(self, request: dict) -> Any:
        if 'model' not in request:
            raise ValueError(f"Wenxin Model name is required")

        model_url_map = {
            'ernie-bot-4': 'completions_pro',
            'ernie-bot': 'completions',
            'ernie-bot-turbo': 'eb-instant',
            'bloomz-7b': 'bloomz_7b1',
        }

        stream = 'stream' in request and request['stream']

        access_token = self.get_access_token()
        api_url = f"{self.base_url}{model_url_map[request['model']]}?access_token={access_token}"
        del request['model']

        headers = {"Content-Type": "application/json"}
        response = requests.post(api_url,
                                 headers=headers,
                                 json=request,
                                 stream=stream)
        if not response.ok:
            raise ValueError(f"Wenxin HTTP {response.status_code} error: {response.text}")

        if not stream:
            json_response = response.json()
            if 'error_code' in json_response:
                raise ValueError(
                    f"Wenxin API {json_response['error_code']}"
                    f" error: {json_response['error_msg']}"
                )
            return json_response
        else:
            return response


class Wenxin(BaseChatModel):
    """Wrapper around Wenxin large language models."""

    @property
    def lc_secrets(self) -> Dict[str, str]:
        return {"api_key": "API_KEY", "secret_key": "SECRET_KEY"}

    @property
    def lc_serializable(self) -> bool:
        return True

    _client: _WenxinEndpointClient = PrivateAttr()
    model: str = "ernie-bot"
    """Model name to use."""
    temperature: float = 0.7
    """A non-negative float that tunes the degree of randomness in generation."""
    top_p: float = 0.95
    """Total probability mass of tokens to consider at each step."""
    model_kwargs: Dict[str, Any] = Field(default_factory=dict)
    """Holds any model parameters valid for `create` call not explicitly specified."""
    streaming: bool = False
    """Whether to stream the response or return it all at once."""
    api_key: Optional[str] = None
    secret_key: Optional[str] = None

    class Config:
        """Configuration for this pydantic object."""

        extra = Extra.forbid

    @root_validator()
    def validate_environment(cls, values: Dict) -> Dict:
        """Validate that api key and python package exists in environment."""
        values["api_key"] = get_from_dict_or_env(
            values, "api_key", "WENXIN_API_KEY"
        )
        values["secret_key"] = get_from_dict_or_env(
            values, "secret_key", "WENXIN_SECRET_KEY"
        )
        return values

    @property
    def _default_params(self) -> Dict[str, Any]:
        """Get the default parameters for calling OpenAI API."""
        return {
            "model": self.model,
            "temperature": self.temperature,
            "top_p": self.top_p,
            "stream": self.streaming,
            **self.model_kwargs,
        }

    @property
    def _identifying_params(self) -> Dict[str, Any]:
        """Get the identifying parameters."""
        return {**{"model": self.model}, **self._default_params}

    @property
    def _llm_type(self) -> str:
        """Return type of llm."""
        return "wenxin"

    def __init__(self, **data: Any):
        super().__init__(**data)
        self._client = _WenxinEndpointClient(
            api_key=self.api_key,
            secret_key=self.secret_key,
        )

    def _convert_message_to_dict(self, message: BaseMessage) -> dict:
        if isinstance(message, ChatMessage):
            message_dict = {"role": message.role, "content": message.content}
        elif isinstance(message, HumanMessage):
            message_dict = {"role": "user", "content": message.content}
        elif isinstance(message, AIMessage):
            message_dict = {"role": "assistant", "content": message.content}
        elif isinstance(message, SystemMessage):
            message_dict = {"role": "system", "content": message.content}
        else:
            raise ValueError(f"Got unknown type {message}")
        return message_dict

    def _create_message_dicts(
        self, messages: List[BaseMessage]
    ) -> Tuple[List[Dict[str, Any]], str]:
        dict_messages = []
        system = None
        for m in messages:
            message = self._convert_message_to_dict(m)
            if message['role'] == 'system':
                if not system:
                    system = message['content']
                else:
                    system += f"\n{message['content']}"
                continue

            if dict_messages:
                previous_message = dict_messages[-1]
                if previous_message['role'] == message['role']:
                    dict_messages[-1]['content'] += f"\n{message['content']}"
                else:
                    dict_messages.append(message)
            else:
                dict_messages.append(message)

        return dict_messages, system

    def _generate(
        self,
        messages: List[BaseMessage],
        stop: Optional[List[str]] = None,
        run_manager: Optional[CallbackManagerForLLMRun] = None,
        **kwargs: Any,
    ) -> ChatResult:
        if self.streaming:
            generation: Optional[ChatGenerationChunk] = None
            llm_output: Optional[Dict] = None
            for chunk in self._stream(
                    messages=messages, stop=stop, run_manager=run_manager, **kwargs
            ):
                if chunk.generation_info is not None \
                        and 'token_usage' in chunk.generation_info:
                    llm_output = {"token_usage": chunk.generation_info['token_usage'], "model_name": self.model}

                if generation is None:
                    generation = chunk
                else:
                    generation += chunk
            assert generation is not None
            return ChatResult(generations=[generation], llm_output=llm_output)
        else:
            message_dicts, system = self._create_message_dicts(messages)
            request = self._default_params
            request["messages"] = message_dicts
            if system:
                request["system"] = system
            request.update(kwargs)
            response = self._client.post(request)
            return self._create_chat_result(response)

    def _stream(
            self,
            messages: List[BaseMessage],
            stop: Optional[List[str]] = None,
            run_manager: Optional[CallbackManagerForLLMRun] = None,
            **kwargs: Any,
    ) -> Iterator[ChatGenerationChunk]:
        message_dicts, system = self._create_message_dicts(messages)
        request = self._default_params
        request["messages"] = message_dicts
        if system:
            request["system"] = system
        request.update(kwargs)

        for token in self._client.post(request).iter_lines():
            if token:
                token = token.decode("utf-8")

                if token.startswith('data:'):
                    completion = json.loads(token[5:])

                    chunk_dict = {
                        'message': AIMessageChunk(content=completion['result']),
                    }

                    if completion['is_end']:
                        token_usage = completion['usage']
                        token_usage['completion_tokens'] = token_usage['total_tokens'] - token_usage['prompt_tokens']
                        chunk_dict['generation_info'] = dict({'token_usage': token_usage})

                    yield ChatGenerationChunk(**chunk_dict)
                    if run_manager:
                        run_manager.on_llm_new_token(completion['result'])
                else:
                    try:
                        json_response = json.loads(token)
                    except JSONDecodeError:
                        raise ValueError(f"Wenxin Response Error {token}")

                    raise ValueError(
                        f"Wenxin API {json_response['error_code']}"
                        f" error: {json_response['error_msg']}, "
                        f"please confirm if the model you have chosen is already paid for."
                    )

    def _create_chat_result(self, response: Dict[str, Any]) -> ChatResult:
        generations = [ChatGeneration(
            message=AIMessage(content=response['result']),
        )]
        token_usage = response.get("usage")
        token_usage['completion_tokens'] = token_usage['total_tokens'] - token_usage['prompt_tokens']

        llm_output = {"token_usage": token_usage, "model_name": self.model}
        return ChatResult(generations=generations, llm_output=llm_output)

    def get_num_tokens_from_messages(self, messages: List[BaseMessage]) -> int:
        """Get the number of tokens in the messages.

        Useful for checking if an input will fit in a model's context window.

        Args:
            messages: The message inputs to tokenize.

        Returns:
            The sum of the number of tokens across the messages.
        """
        return sum([self.get_num_tokens(m.content) for m in messages])

    def _combine_llm_outputs(self, llm_outputs: List[Optional[dict]]) -> dict:
        overall_token_usage: dict = {}
        for output in llm_outputs:
            if output is None:
                # Happens in streaming
                continue
            token_usage = output["token_usage"]
            for k, v in token_usage.items():
                if k in overall_token_usage:
                    overall_token_usage[k] += v
                else:
                    overall_token_usage[k] = v
        return {"token_usage": overall_token_usage, "model_name": self.model}
