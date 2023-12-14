from typing import Dict, Any, Optional, List, Tuple, Union, cast

from langchain.callbacks.manager import CallbackManagerForLLMRun
from langchain.chat_models import AzureChatOpenAI
from langchain.chat_models.openai import _convert_dict_to_message
from pydantic import root_validator

from langchain.schema import ChatResult, BaseMessage, ChatGeneration, ChatMessage, HumanMessage, AIMessage, SystemMessage, FunctionMessage
from core.model_providers.models.entity.message import LCHumanMessageWithFiles, PromptMessageFileType, ImagePromptMessageFile


class EnhanceAzureChatOpenAI(AzureChatOpenAI):
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

    def _generate(
            self,
            messages: List[BaseMessage],
            stop: Optional[List[str]] = None,
            run_manager: Optional[CallbackManagerForLLMRun] = None,
            **kwargs: Any,
    ) -> ChatResult:
        params = self._client_params
        if stop is not None:
            if "stop" in params:
                raise ValueError("`stop` found in both the input and default params.")
            params["stop"] = stop
        message_dicts = [self._convert_message_to_dict(m) for m in messages]
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

    def _convert_message_to_dict(self, message: BaseMessage) -> dict:
        if isinstance(message, ChatMessage):
            message_dict = {"role": message.role, "content": message.content}
        elif isinstance(message, LCHumanMessageWithFiles):
            content = [
                {
                    "type": "text",
                    "text": message.content
                }
            ]

            for file in message.files:
                if file.type == PromptMessageFileType.IMAGE:
                    file = cast(ImagePromptMessageFile, file)
                    content.append({
                        "type": "image_url",
                        "image_url": {
                            "url": file.data,
                            "detail": file.detail.value
                        }
                    })

            message_dict = {"role": "user", "content": content}
        elif isinstance(message, HumanMessage):
            message_dict = {"role": "user", "content": message.content}
        elif isinstance(message, AIMessage):
            message_dict = {"role": "assistant", "content": message.content}
            if "function_call" in message.additional_kwargs:
                message_dict["function_call"] = message.additional_kwargs["function_call"]
        elif isinstance(message, SystemMessage):
            message_dict = {"role": "system", "content": message.content}
        elif isinstance(message, FunctionMessage):
            message_dict = {
                "role": "function",
                "content": message.content,
                "name": message.name,
            }
        else:
            raise ValueError(f"Got unknown type {message}")
        if "name" in message.additional_kwargs:
            message_dict["name"] = message.additional_kwargs["name"]
        return message_dict
