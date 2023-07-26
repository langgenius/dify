from langchain.callbacks.manager import Callbacks, CallbackManagerForLLMRun
from langchain.chat_models.openai import _convert_dict_to_message
from langchain.schema import BaseMessage, LLMResult, ChatResult, ChatGeneration
from langchain.chat_models import AzureChatOpenAI
from typing import Optional, List, Dict, Any, Tuple, Union

from pydantic import root_validator

from core.llm.wrappers.openai_wrapper import handle_openai_exceptions


class StreamableAzureChatOpenAI(AzureChatOpenAI):
    request_timeout: Optional[Union[float, Tuple[float, float]]] = (5.0, 300.0)
    """Timeout for requests to OpenAI completion API. Default is 600 seconds."""
    max_retries: int = 1
    """Maximum number of retries to make when generating."""

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
            "engine": self.deployment_name,
            "api_type": self.openai_api_type,
            "api_base": self.openai_api_base,
            "api_version": self.openai_api_version,
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

    def _generate(
        self,
        messages: List[BaseMessage],
        stop: Optional[List[str]] = None,
        run_manager: Optional[CallbackManagerForLLMRun] = None,
        **kwargs: Any,
    ) -> ChatResult:
        message_dicts, params = self._create_message_dicts(messages, stop)
        params = {**params, **kwargs}
        if self.streaming:
            inner_completion = ""
            role = "assistant"
            params["stream"] = True
            function_call: Optional[dict] = None
            for stream_resp in self.completion_with_retry(
                messages=message_dicts, **params
            ):
                if len(stream_resp["choices"]) > 0:
                    role = stream_resp["choices"][0]["delta"].get("role", role)
                    token = stream_resp["choices"][0]["delta"].get("content") or ""
                    inner_completion += token
                    _function_call = stream_resp["choices"][0]["delta"].get("function_call")
                    if _function_call:
                        if function_call is None:
                            function_call = _function_call
                        else:
                            function_call["arguments"] += _function_call["arguments"]
                    if run_manager:
                        run_manager.on_llm_new_token(token)
            message = _convert_dict_to_message(
                {
                    "content": inner_completion,
                    "role": role,
                    "function_call": function_call,
                }
            )
            return ChatResult(generations=[ChatGeneration(message=message)])
        response = self.completion_with_retry(messages=message_dicts, **params)
        return self._create_chat_result(response)
