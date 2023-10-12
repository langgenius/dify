import json
from typing import Dict, Any, Optional, List, Tuple, Iterator

import requests
from langchain.callbacks.manager import CallbackManagerForLLMRun
from langchain.chat_models.base import BaseChatModel
from langchain.llms.utils import enforce_stop_tokens
from langchain.schema import BaseMessage, ChatResult, HumanMessage, AIMessage, SystemMessage
from langchain.schema.messages import AIMessageChunk
from langchain.schema.output import ChatGenerationChunk, ChatGeneration
from langchain.utils import get_from_dict_or_env
from pydantic import root_validator, Field, BaseModel


class _MinimaxEndpointClient(BaseModel):
    """An API client that talks to a Minimax llm endpoint."""

    host: str
    group_id: str
    api_key: str
    api_url: str

    @root_validator(pre=True)
    def set_api_url(cls, values: Dict[str, Any]) -> Dict[str, Any]:
        if "api_url" not in values:
            host = values["host"]
            group_id = values["group_id"]
            api_url = f"{host}/v1/text/chatcompletion?GroupId={group_id}"
            values["api_url"] = api_url
        return values

    def post(self, **request: Any) -> Any:
        stream = 'stream' in request and request['stream']

        headers = {"Authorization": f"Bearer {self.api_key}"}
        response = requests.post(self.api_url, headers=headers, json=request, stream=stream, timeout=(5, 60))
        if not response.ok:
            raise ValueError(f"HTTP {response.status_code} error: {response.text}")

        if not stream:
            if response.json()["base_resp"]["status_code"] > 0:
                raise ValueError(
                    f"API {response.json()['base_resp']['status_code']}"
                    f" error: {response.json()['base_resp']['status_msg']}"
                )
            return response.json()
        else:
            return response


class MinimaxChatLLM(BaseChatModel):

    _client: _MinimaxEndpointClient
    model: str = "abab5.5-chat"
    """Model name to use."""
    max_tokens: int = 256
    """Denotes the number of tokens to predict per generation."""
    temperature: float = 0.7
    """A non-negative float that tunes the degree of randomness in generation."""
    top_p: float = 0.95
    """Total probability mass of tokens to consider at each step."""
    model_kwargs: Dict[str, Any] = Field(default_factory=dict)
    """Holds any model parameters valid for `create` call not explicitly specified."""
    streaming: bool = False
    """Whether to stream the response or return it all at once."""
    minimax_api_host: Optional[str] = None
    minimax_group_id: Optional[str] = None
    minimax_api_key: Optional[str] = None

    @property
    def lc_secrets(self) -> Dict[str, str]:
        return {"minimax_api_key": "MINIMAX_API_KEY"}

    @property
    def lc_serializable(self) -> bool:
        return True

    @root_validator()
    def validate_environment(cls, values: Dict) -> Dict:
        """Validate that api key and python package exists in environment."""
        values["minimax_api_key"] = get_from_dict_or_env(
            values, "minimax_api_key", "MINIMAX_API_KEY"
        )
        values["minimax_group_id"] = get_from_dict_or_env(
            values, "minimax_group_id", "MINIMAX_GROUP_ID"
        )
        # Get custom api url from environment.
        values["minimax_api_host"] = get_from_dict_or_env(
            values,
            "minimax_api_host",
            "MINIMAX_API_HOST",
            default="https://api.minimax.chat",
        )
        values["_client"] = _MinimaxEndpointClient(
            host=values["minimax_api_host"],
            api_key=values["minimax_api_key"],
            group_id=values["minimax_group_id"],
        )
        return values

    @property
    def _default_params(self) -> Dict[str, Any]:
        """Get the default parameters for calling OpenAI API."""
        return {
            "model": self.model,
            "tokens_to_generate": self.max_tokens,
            "temperature": self.temperature,
            "top_p": self.top_p,
            "role_meta": {"user_name": "我", "bot_name": "专家"},
            **self.model_kwargs,
        }

    @property
    def _identifying_params(self) -> Dict[str, Any]:
        """Get the identifying parameters."""
        return {**{"model": self.model}, **self._default_params}

    @property
    def _llm_type(self) -> str:
        """Return type of llm."""
        return "minimax"

    def _convert_message_to_dict(self, message: BaseMessage) -> dict:
        if isinstance(message, HumanMessage):
            message_dict = {"sender_type": "USER", "text": message.content}
        elif isinstance(message, AIMessage):
            message_dict = {"sender_type": "BOT", "text": message.content}
        else:
            raise ValueError(f"Got unknown type {message}")
        return message_dict

    def _create_messages_and_prompt(
        self, messages: List[BaseMessage]
    ) -> Tuple[List[Dict[str, Any]], str]:
        prompt = ""
        dict_messages = []
        for m in messages:
            if isinstance(m, SystemMessage):
                if prompt:
                    prompt += "\n"
                prompt += f"{m.content}"
                continue

            message = self._convert_message_to_dict(m)
            dict_messages.append(message)

        prompt = prompt if prompt else ' '

        return dict_messages, prompt

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
            message_dicts, prompt = self._create_messages_and_prompt(messages)
            params = self._default_params
            params["messages"] = message_dicts
            params["prompt"] = prompt
            params.update(kwargs)
            response = self._client.post(**params)
            return self._create_chat_result(response, stop)

    def _stream(
            self,
            messages: List[BaseMessage],
            stop: Optional[List[str]] = None,
            run_manager: Optional[CallbackManagerForLLMRun] = None,
            **kwargs: Any,
    ) -> Iterator[ChatGenerationChunk]:
        message_dicts, prompt = self._create_messages_and_prompt(messages)
        params = self._default_params
        params["messages"] = message_dicts
        params["prompt"] = prompt
        params["stream"] = True
        params.update(kwargs)

        for token in self._client.post(**params).iter_lines():
            if token:
                token = token.decode("utf-8")

                if not token.startswith("data:"):
                    data = json.loads(token)
                    if "base_resp" in data and data["base_resp"]["status_code"] > 0:
                        raise ValueError(
                            f"API {data['base_resp']['status_code']}"
                            f" error: {data['base_resp']['status_msg']}"
                        )
                    else:
                        continue

                token = token.lstrip("data:").strip()
                data = json.loads(token)
                content = data['choices'][0]['delta']

                chunk_kwargs = {
                    'message': AIMessageChunk(content=content),
                }

                if 'usage' in data:
                    token_usage = data['usage']
                    overall_token_usage = {
                        'prompt_tokens': 0,
                        'completion_tokens': token_usage.get('total_tokens', 0),
                        'total_tokens': token_usage.get('total_tokens', 0)
                    }
                    chunk_kwargs['generation_info'] = {'token_usage': overall_token_usage}

                yield ChatGenerationChunk(**chunk_kwargs)
                if run_manager:
                    run_manager.on_llm_new_token(content)

    def _create_chat_result(self, response: Dict[str, Any], stop: Optional[List[str]] = None) -> ChatResult:
        text = response['reply']
        if stop is not None:
            # This is required since the stop tokens
            # are not enforced by the model parameters
            text = enforce_stop_tokens(text, stop)

        generations = [ChatGeneration(message=AIMessage(content=text))]
        usage = response.get("usage")

        # only return total_tokens in minimax response
        token_usage = {
            'prompt_tokens': 0,
            'completion_tokens': usage.get('total_tokens', 0),
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
