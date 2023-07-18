import os

from langchain.callbacks.manager import Callbacks
from langchain.schema import BaseMessage, LLMResult
from langchain.chat_models import ChatOpenAI
from typing import Optional, List, Dict, Any

from pydantic import root_validator

from core.llm.wrappers.openai_wrapper import handle_openai_exceptions


class StreamableChatOpenAI(ChatOpenAI):

    @root_validator()
    def validate_environment(cls, values: Dict) -> Dict:
        """Validate that api key and python package exists in environment."""
        try:
            import openai
        except ImportError:
            raise ValueError(
                "Could not import openai python package. "
                "Please install it with `pip install openai`."
            )
        try:
            values["client"] = openai.ChatCompletion
        except AttributeError:
            raise ValueError(
                "`openai` has no `ChatCompletion` attribute, this is likely "
                "due to an old version of the openai package. Try upgrading it "
                "with `pip install --upgrade openai`."
            )
        if values["n"] < 1:
            raise ValueError("n must be at least 1.")
        if values["n"] > 1 and values["streaming"]:
            raise ValueError("n must be 1 when streaming.")
        return values

    @property
    def _default_params(self) -> Dict[str, Any]:
        """Get the default parameters for calling OpenAI API."""
        return {
            **super()._default_params,
            "api_type": 'openai',
            "api_base": os.environ.get("OPENAI_API_BASE", "https://api.openai.com/v1"),
            "api_version": None,
            "api_key": self.openai_api_key,
            "organization": self.openai_organization if self.openai_organization else None,
        }

    @handle_openai_exceptions
    def generate(
            self,
            messages: List[List[BaseMessage]],
            stop: Optional[List[str]] = None,
            callbacks: Callbacks = None,
            **kwargs: Any,
    ) -> LLMResult:
        return super().generate(messages, stop, callbacks, **kwargs)

    @classmethod
    def get_kwargs_from_model_params(cls, params: dict):
        model_kwargs = {
            'top_p': params.get('top_p', 1),
            'frequency_penalty': params.get('frequency_penalty', 0),
            'presence_penalty': params.get('presence_penalty', 0),
        }

        del params['top_p']
        del params['frequency_penalty']
        del params['presence_penalty']

        params['model_kwargs'] = model_kwargs

        return params
