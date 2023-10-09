"""Wrapper around Baichuan APIs."""
from __future__ import annotations

import hashlib
import json
import logging
import time
from typing import (
    Any,
    Dict,
    List,
    Optional, Iterator,
)

import requests
from langchain.chat_models.base import BaseChatModel
from langchain.schema import BaseMessage, ChatMessage, HumanMessage, AIMessage, SystemMessage
from langchain.schema.messages import AIMessageChunk
from langchain.schema.output import ChatResult, ChatGenerationChunk, ChatGeneration
from pydantic import Extra, root_validator, BaseModel

from langchain.callbacks.manager import (
    CallbackManagerForLLMRun,
)
from langchain.utils import get_from_dict_or_env

logger = logging.getLogger(__name__)


class BaichuanModelAPI(BaseModel):
    api_key: str
    secret_key: str

    base_url: str = "https://api.baichuan-ai.com/v1"

    class Config:
        """Configuration for this pydantic object."""

        extra = Extra.forbid

    def do_request(self, model: str, messages: list[dict], parameters: dict, **kwargs: Any):
        stream = 'stream' in kwargs and kwargs['stream']

        url = self.base_url + ("/stream/chat" if stream else "/chat")

        data = {
            "model": model,
            "messages": messages,
            "parameters": parameters
        }

        json_data = json.dumps(data)
        time_stamp = int(time.time())
        signature = self._calculate_md5(self.secret_key + json_data + str(time_stamp))

        headers = {
            "Content-Type": "application/json",
            "Authorization": "Bearer " + self.api_key,
            "X-BC-Request-Id": "your requestId",
            "X-BC-Timestamp": str(time_stamp),
            "X-BC-Signature": signature,
            "X-BC-Sign-Algo": "MD5",
        }

        response = requests.post(url, data=json_data, headers=headers, stream=stream, timeout=(5, 60))

        if not response.ok:
            raise ValueError(f"HTTP {response.status_code} error: {response.text}")

        if not stream:
            json_response = response.json()
            if json_response['code'] != 0:
                raise ValueError(
                    f"API {json_response['code']}"
                    f" error: {json_response['msg']}"
                )
            return json_response
        else:
            return response

    def _calculate_md5(self, input_string):
        md5 = hashlib.md5()
        md5.update(input_string.encode('utf-8'))
        encrypted = md5.hexdigest()
        return encrypted


class BaichuanChatLLM(BaseChatModel):
    """Wrapper around Baichuan large language models.
    To use, you should pass the api_key as a named parameter to the constructor.
    Example:
     .. code-block:: python
         from core.third_party.langchain.llms.baichuan_llm import BaichuanChatLLM
         model = BaichuanChatLLM(model="<model_name>", api_key="my-api-key", secret_key="my-secret-key")
    """

    @property
    def lc_secrets(self) -> Dict[str, str]:
        return {"api_key": "API_KEY", "secret_key": "SECRET_KEY"}

    @property
    def lc_serializable(self) -> bool:
        return True

    client: Any = None  #: :meta private:
    model: str = "Baichuan2-53B"
    """Model name to use."""
    temperature: float = 0.3
    """A non-negative float that tunes the degree of randomness in generation."""
    top_p: float = 0.85
    """Total probability mass of tokens to consider at each step."""
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
            values, "api_key", "BAICHUAN_API_KEY"
        )

        values["secret_key"] = get_from_dict_or_env(
            values, "secret_key", "BAICHUAN_SECRET_KEY"
        )

        values['client'] = BaichuanModelAPI(
            api_key=values['api_key'],
            secret_key=values['secret_key']
        )
        return values

    @property
    def _default_params(self) -> Dict[str, Any]:
        """Get the default parameters for calling OpenAI API."""
        return {
            "model": self.model,
            "parameters": {
                "temperature": self.temperature,
                "top_p": self.top_p
            }
        }

    @property
    def _identifying_params(self) -> Dict[str, Any]:
        """Get the identifying parameters."""
        return self._default_params

    @property
    def _llm_type(self) -> str:
        """Return type of llm."""
        return "baichuan"

    def _convert_message_to_dict(self, message: BaseMessage) -> dict:
        if isinstance(message, ChatMessage):
            message_dict = {"role": message.role, "content": message.content}
        elif isinstance(message, HumanMessage):
            message_dict = {"role": "user", "content": message.content}
        elif isinstance(message, AIMessage):
            message_dict = {"role": "assistant", "content": message.content}
        elif isinstance(message, SystemMessage):
            message_dict = {"role": "user", "content": message.content}
        else:
            raise ValueError(f"Got unknown type {message}")
        return message_dict

    def _convert_dict_to_message(self, _dict: Dict[str, Any]) -> BaseMessage:
        role = _dict["role"]
        if role == "user":
            return HumanMessage(content=_dict["content"])
        elif role == "assistant":
            return AIMessage(content=_dict["content"])
        elif role == "system":
            return SystemMessage(content=_dict["content"])
        else:
            return ChatMessage(content=_dict["content"], role=role)

    def _create_message_dicts(
        self, messages: List[BaseMessage]
    ) -> List[Dict[str, Any]]:
        dict_messages = []
        for m in messages:
            message = self._convert_message_to_dict(m)
            if dict_messages:
                previous_message = dict_messages[-1]
                if previous_message['role'] == message['role']:
                    dict_messages[-1]['content'] += f"\n{message['content']}"
                else:
                    dict_messages.append(message)
            else:
                dict_messages.append(message)

        return dict_messages

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
                if generation is None:
                    generation = chunk
                else:
                    generation += chunk

                if chunk.generation_info is not None \
                        and 'token_usage' in chunk.generation_info:
                    llm_output = {"token_usage": chunk.generation_info['token_usage'], "model_name": self.model}

            assert generation is not None
            return ChatResult(generations=[generation], llm_output=llm_output)
        else:
            message_dicts = self._create_message_dicts(messages)
            params = self._default_params
            params["messages"] = message_dicts
            params.update(kwargs)
            response = self.client.do_request(**params)
            return self._create_chat_result(response)

    def _stream(
            self,
            messages: List[BaseMessage],
            stop: Optional[List[str]] = None,
            run_manager: Optional[CallbackManagerForLLMRun] = None,
            **kwargs: Any,
    ) -> Iterator[ChatGenerationChunk]:
        message_dicts = self._create_message_dicts(messages)
        params = self._default_params
        params["messages"] = message_dicts
        params.update(kwargs)

        for event in self.client.do_request(stream=True, **params).iter_lines():
            if event:
                event = event.decode("utf-8")

                meta = json.loads(event)

                if meta['code'] != 0:
                    raise ValueError(
                        f"API {meta['code']}"
                        f" error: {meta['msg']}"
                    )

                content = meta['data']['messages'][0]['content']

                chunk_kwargs = {
                    'message': AIMessageChunk(content=content),
                }

                if 'usage' in meta:
                    token_usage = meta['usage']
                    overall_token_usage = {
                        'prompt_tokens': token_usage.get('prompt_tokens', 0),
                        'completion_tokens': token_usage.get('answer_tokens', 0),
                        'total_tokens': token_usage.get('total_tokens', 0)
                    }
                    chunk_kwargs['generation_info'] = {'token_usage': overall_token_usage}

                yield ChatGenerationChunk(**chunk_kwargs)
                if run_manager:
                    run_manager.on_llm_new_token(content)

    def _create_chat_result(self, response: Dict[str, Any]) -> ChatResult:
        data = response["data"]
        generations = []
        for res in data["messages"]:
            message = self._convert_dict_to_message(res)
            gen = ChatGeneration(
                message=message
            )
            generations.append(gen)
        usage = response.get("usage")
        token_usage = {
            'prompt_tokens': usage.get('prompt_tokens', 0),
            'completion_tokens': usage.get('answer_tokens', 0),
            'total_tokens': usage.get('total_tokens', 0)
        }
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
        token_usage: dict = {}
        for output in llm_outputs:
            if output is None:
                # Happens in streaming
                continue
            token_usage = output["token_usage"]

        return {"token_usage": token_usage, "model_name": self.model}
