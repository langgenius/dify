"""Wrapper around ZhipuAI APIs."""
from __future__ import annotations

import json
import logging
import posixpath
from typing import (
    Any,
    Dict,
    List,
    Optional, Iterator, Sequence,
)

import zhipuai
from langchain.chat_models.base import BaseChatModel
from langchain.schema import BaseMessage, ChatMessage, HumanMessage, AIMessage, SystemMessage
from langchain.schema.messages import AIMessageChunk
from langchain.schema.output import ChatResult, ChatGenerationChunk, ChatGeneration
from pydantic import Extra, root_validator, BaseModel

from langchain.callbacks.manager import (
    CallbackManagerForLLMRun,
)
from langchain.utils import get_from_dict_or_env
from zhipuai.model_api.api import InvokeType
from zhipuai.utils import jwt_token
from zhipuai.utils.http_client import post, stream
from zhipuai.utils.sse_client import SSEClient

logger = logging.getLogger(__name__)


class ZhipuModelAPI(BaseModel):
    base_url: str
    api_key: str
    api_timeout_seconds = 60

    class Config:
        """Configuration for this pydantic object."""

        extra = Extra.forbid

    def invoke(self, **kwargs):
        url = self._build_api_url(kwargs, InvokeType.SYNC)
        response = post(url, self._generate_token(), kwargs, self.api_timeout_seconds)
        if not response['success']:
            raise ValueError(
                f"Error Code: {response['code']}, Message: {response['msg']} "
            )
        return response

    def sse_invoke(self, **kwargs):
        url = self._build_api_url(kwargs, InvokeType.SSE)
        data = stream(url, self._generate_token(), kwargs, self.api_timeout_seconds)
        return SSEClient(data)

    def _build_api_url(self, kwargs, *path):
        if kwargs:
            if "model" not in kwargs:
                raise Exception("model param missed")
            model = kwargs.pop("model")
        else:
            model = "-"

        return posixpath.join(self.base_url, model, *path)

    def _generate_token(self):
        if not self.api_key:
            raise Exception(
                "api_key not provided, you could provide it."
            )

        try:
            return jwt_token.generate_token(self.api_key)
        except Exception:
            raise ValueError(
                f"Your api_key is invalid, please check it."
            )


class ZhipuAIChatLLM(BaseChatModel):
    """Wrapper around ZhipuAI large language models.
    To use, you should pass the api_key as a named parameter to the constructor.
    Example:
     .. code-block:: python
         from core.third_party.langchain.llms.zhipuai import ZhipuAI
         model = ZhipuAI(model="<model_name>", api_key="my-api-key")
    """

    @property
    def lc_secrets(self) -> Dict[str, str]:
        return {"api_key": "API_KEY"}

    @property
    def lc_serializable(self) -> bool:
        return True

    client: Any = None  #: :meta private:
    model: str = "chatglm_lite"
    """Model name to use."""
    temperature: float = 0.95
    """A non-negative float that tunes the degree of randomness in generation."""
    top_p: float = 0.7
    """Total probability mass of tokens to consider at each step."""
    streaming: bool = False
    """Whether to stream the response or return it all at once."""
    api_key: Optional[str] = None

    base_url: str = "https://open.bigmodel.cn/api/paas/v3/model-api"

    class Config:
        """Configuration for this pydantic object."""

        extra = Extra.forbid

    @root_validator()
    def validate_environment(cls, values: Dict) -> Dict:
        """Validate that api key and python package exists in environment."""
        values["api_key"] = get_from_dict_or_env(
            values, "api_key", "ZHIPUAI_API_KEY"
        )

        if 'test' in values['base_url']:
            values['model'] = 'chatglm_130b_test'

        values['client'] = ZhipuModelAPI(api_key=values['api_key'], base_url=values['base_url'])
        return values

    @property
    def _default_params(self) -> Dict[str, Any]:
        """Get the default parameters for calling OpenAI API."""
        return {
            "model": self.model,
            "temperature": self.temperature,
            "top_p": self.top_p
        }

    @property
    def _identifying_params(self) -> Dict[str, Any]:
        """Get the identifying parameters."""
        return self._default_params

    @property
    def _llm_type(self) -> str:
        """Return type of llm."""
        return "zhipuai"

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
                if chunk.generation_info is not None \
                        and 'token_usage' in chunk.generation_info:
                    llm_output = {"token_usage": chunk.generation_info['token_usage'], "model_name": self.model}
                    continue

                if generation is None:
                    generation = chunk
                else:
                    generation += chunk
            assert generation is not None
            return ChatResult(generations=[generation], llm_output=llm_output)
        else:
            message_dicts = self._create_message_dicts(messages)
            request = self._default_params
            request["prompt"] = message_dicts
            request.update(kwargs)
            response = self.client.invoke(**request)
            return self._create_chat_result(response)

    def _stream(
            self,
            messages: List[BaseMessage],
            stop: Optional[List[str]] = None,
            run_manager: Optional[CallbackManagerForLLMRun] = None,
            **kwargs: Any,
    ) -> Iterator[ChatGenerationChunk]:
        message_dicts = self._create_message_dicts(messages)
        request = self._default_params
        request["prompt"] = message_dicts
        request.update(kwargs)

        for event in self.client.sse_invoke(incremental=True, **request).events():
            if event.event == "add":
                yield ChatGenerationChunk(message=AIMessageChunk(content=event.data))
                if run_manager:
                    run_manager.on_llm_new_token(event.data)
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

                yield ChatGenerationChunk(
                    message=AIMessageChunk(content=event.data),
                    generation_info=dict({'token_usage': token_usage})
                )

    def _create_chat_result(self, response: Dict[str, Any]) -> ChatResult:
        data = response["data"]
        generations = []
        for res in data["choices"]:
            message = self._convert_dict_to_message(res)
            gen = ChatGeneration(
                message=message
            )
            generations.append(gen)
        token_usage = data.get("usage")
        if token_usage is not None:
            if 'prompt_tokens' not in token_usage:
                token_usage['prompt_tokens'] = 0
            if 'completion_tokens' not in token_usage:
                token_usage['completion_tokens'] = token_usage['total_tokens']

        llm_output = {"token_usage": token_usage, "model_name": self.model}
        return ChatResult(generations=generations, llm_output=llm_output)

    # def get_token_ids(self, text: str) -> List[int]:
    #     """Return the ordered ids of the tokens in a text.
    #
    #     Args:
    #         text: The string input to tokenize.
    #
    #     Returns:
    #         A list of ids corresponding to the tokens in the text, in order they occur
    #             in the text.
    #     """
    #     from core.third_party.transformers.Token import ChatGLMTokenizer
    #
    #     tokenizer = ChatGLMTokenizer.from_pretrained("THUDM/chatglm2-6b")
    #     return tokenizer.encode(text)

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
