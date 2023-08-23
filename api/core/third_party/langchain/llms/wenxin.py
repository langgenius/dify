"""Wrapper around Wenxin APIs."""
from __future__ import annotations

import json
import logging
from json import JSONDecodeError
from typing import (
    Any,
    Dict,
    List,
    Optional, Iterator,
)

import requests
from langchain.llms.utils import enforce_stop_tokens
from langchain.schema.output import GenerationChunk
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
            'ernie-bot': 'completions',
            'ernie-bot-turbo': 'eb-instant',
            'bloomz-7b': 'bloomz_7b1',
        }

        stream = 'stream' in request and request['stream']

        access_token = self.get_access_token()
        api_url = f"{self.base_url}{model_url_map[request['model']]}?access_token={access_token}"

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
            return json_response["result"]
        else:
            return response


class Wenxin(LLM):
    """Wrapper around Wenxin large language models.
    To use, you should have the environment variable
    ``WENXIN_API_KEY`` and ``WENXIN_SECRET_KEY`` set with your API key,
    or pass them as a named parameter to the constructor.
    Example:
     .. code-block:: python
         from langchain.llms.wenxin import Wenxin
         wenxin = Wenxin(model="<model_name>", api_key="my-api-key",
          secret_key="my-group-id")
    """

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

    def _call(
        self,
        prompt: str,
        stop: Optional[List[str]] = None,
        run_manager: Optional[CallbackManagerForLLMRun] = None,
        **kwargs: Any,
    ) -> str:
        r"""Call out to Wenxin's completion endpoint to chat
        Args:
            prompt: The prompt to pass into the model.
        Returns:
            The string generated by the model.
        Example:
            .. code-block:: python
                response = wenxin("Tell me a joke.")
        """
        if self.streaming:
            completion = ""
            for chunk in self._stream(
                prompt=prompt, stop=stop, run_manager=run_manager, **kwargs
            ):
                completion += chunk.text
        else:
            request = self._default_params
            request["messages"] = [{"role": "user", "content": prompt}]
            request.update(kwargs)
            completion = self._client.post(request)

        if stop is not None:
            completion = enforce_stop_tokens(completion, stop)

        return completion

    def _stream(
        self,
        prompt: str,
        stop: Optional[List[str]] = None,
        run_manager: Optional[CallbackManagerForLLMRun] = None,
        **kwargs: Any,
    ) -> Iterator[GenerationChunk]:
        r"""Call wenxin completion_stream and return the resulting generator.

        Args:
            prompt: The prompt to pass into the model.
            stop: Optional list of stop words to use when generating.
        Returns:
            A generator representing the stream of tokens from Wenxin.
        Example:
            .. code-block:: python

                prompt = "Write a poem about a stream."
                prompt = f"\n\nHuman: {prompt}\n\nAssistant:"
                generator = wenxin.stream(prompt)
                for token in generator:
                    yield token
        """
        request = self._default_params
        request["messages"] = [{"role": "user", "content": prompt}]
        request.update(kwargs)

        for token in self._client.post(request).iter_lines():
            if token:
                token = token.decode("utf-8")

                if token.startswith('data:'):
                    completion = json.loads(token[5:])

                    yield GenerationChunk(text=completion['result'])
                    if run_manager:
                        run_manager.on_llm_new_token(completion['result'])

                    if completion['is_end']:
                        break
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
