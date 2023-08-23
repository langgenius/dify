import re
import string
import threading
from _decimal import Decimal, ROUND_HALF_UP
from typing import Dict, List, Optional, Any, Mapping

from langchain.callbacks.manager import CallbackManagerForLLMRun, AsyncCallbackManagerForLLMRun
from langchain.chat_models.base import BaseChatModel
from langchain.llms.utils import enforce_stop_tokens
from langchain.schema import BaseMessage, ChatMessage, HumanMessage, AIMessage, SystemMessage, ChatResult, \
    ChatGeneration
from langchain.utils import get_from_dict_or_env
from pydantic import root_validator

from core.third_party.spark.spark_llm import SparkLLMClient


class ChatSpark(BaseChatModel):
    r"""Wrapper around Spark's large language model.

    To use, you should pass `app_id`, `api_key`, `api_secret`
    as a named parameter to the constructor.

    Example:
        .. code-block:: python

        client = SparkLLMClient(
            model_name="<model_name>",
            app_id="<app_id>",
            api_key="<api_key>",
            api_secret="<api_secret>"
        )
    """
    client: Any = None  #: :meta private:

    model_name: str = "spark"
    """The Spark model name."""

    max_tokens: int = 256
    """Denotes the number of tokens to predict per generation."""

    temperature: Optional[float] = None
    """A non-negative float that tunes the degree of randomness in generation."""

    top_k: Optional[int] = None
    """Number of most likely tokens to consider at each step."""

    user_id: Optional[str] = None
    """User ID to use for the model."""

    streaming: bool = False
    """Whether to stream the results."""

    app_id: Optional[str] = None
    api_key: Optional[str] = None
    api_secret: Optional[str] = None
    api_domain: Optional[str] = None

    @root_validator()
    def validate_environment(cls, values: Dict) -> Dict:
        """Validate that api key and python package exists in environment."""
        values["app_id"] = get_from_dict_or_env(
            values, "app_id", "SPARK_APP_ID"
        )
        values["api_key"] = get_from_dict_or_env(
            values, "api_key", "SPARK_API_KEY"
        )
        values["api_secret"] = get_from_dict_or_env(
            values, "api_secret", "SPARK_API_SECRET"
        )

        values["client"] = SparkLLMClient(
            model_name=values["model_name"],
            app_id=values["app_id"],
            api_key=values["api_key"],
            api_secret=values["api_secret"],
            api_domain=values.get('api_domain')
        )
        return values

    @property
    def _default_params(self) -> Mapping[str, Any]:
        """Get the default parameters for calling Anthropic API."""
        d = {
            "max_tokens": self.max_tokens
        }
        if self.temperature is not None:
            d["temperature"] = self.temperature
        if self.top_k is not None:
            d["top_k"] = self.top_k
        return d

    @property
    def _identifying_params(self) -> Mapping[str, Any]:
        """Get the identifying parameters."""
        return {**{}, **self._default_params}
    @property
    def lc_secrets(self) -> Dict[str, str]:
        return {"api_key": "API_KEY", "api_secret": "API_SECRET"}

    @property
    def _llm_type(self) -> str:
        """Return type of chat model."""
        return "spark-chat"

    @property
    def lc_serializable(self) -> bool:
        return True

    def _convert_messages_to_dicts(self, messages: List[BaseMessage]) -> list[dict]:
        """Format a list of messages into a full dict list.

        Args:
            messages (List[BaseMessage]): List of BaseMessage to combine.

        Returns:
            list[dict]
        """
        messages = messages.copy()  # don't mutate the original list

        new_messages = []
        for message in messages:
            if isinstance(message, ChatMessage):
                new_messages.append({'role': 'user', 'content': message.content})
            elif isinstance(message, HumanMessage) or isinstance(message, SystemMessage):
                new_messages.append({'role': 'user', 'content': message.content})
            elif isinstance(message, AIMessage):
                new_messages.append({'role': 'assistant', 'content': message.content})
            else:
                raise ValueError(f"Got unknown type {message}")

        return new_messages

    def _generate(
        self,
        messages: List[BaseMessage],
        stop: Optional[List[str]] = None,
        run_manager: Optional[CallbackManagerForLLMRun] = None,
        **kwargs: Any,
    ) -> ChatResult:
        messages = self._convert_messages_to_dicts(messages)

        thread = threading.Thread(target=self.client.run, args=(
            messages,
            self.user_id,
            self._default_params,
            self.streaming
        ))
        thread.start()

        completion = ""
        for content in self.client.subscribe():
            if isinstance(content, dict):
                delta = content['data']
            else:
                delta = content

            completion += delta
            if self.streaming and run_manager:
                run_manager.on_llm_new_token(
                    delta,
                )

        thread.join()

        if stop is not None:
            completion = enforce_stop_tokens(completion, stop)

        message = AIMessage(content=completion)
        return ChatResult(generations=[ChatGeneration(message=message)])

    async def _agenerate(
        self,
        messages: List[BaseMessage],
        stop: Optional[List[str]] = None,
        run_manager: Optional[AsyncCallbackManagerForLLMRun] = None,
        **kwargs: Any,
    ) -> ChatResult:
        message = AIMessage(content='')
        return ChatResult(generations=[ChatGeneration(message=message)])

    def get_num_tokens(self, text: str) -> float:
        """Calculate number of tokens."""
        total = Decimal(0)
        words = re.findall(r'\b\w+\b|[{}]|\s'.format(re.escape(string.punctuation)), text)
        for word in words:
            if word:
                if '\u4e00' <= word <= '\u9fff':  # if chinese
                    total += Decimal('1.5')
                else:
                    total += Decimal('0.8')
        return int(total)
