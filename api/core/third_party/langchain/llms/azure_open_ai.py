from typing import Dict, Any, Mapping, Optional, List, Union, Tuple

from langchain.callbacks.manager import CallbackManagerForLLMRun
from langchain.llms import AzureOpenAI
from langchain.llms.openai import _streaming_response_template, completion_with_retry, _update_response, \
    update_token_usage
from langchain.schema import LLMResult
from pydantic import root_validator


class EnhanceAzureOpenAI(AzureOpenAI):
    openai_api_type: str = "azure"
    openai_api_version: str = ""
    request_timeout: Optional[Union[float, Tuple[float, float]]] = (5.0, 300.0)
    """Timeout for requests to OpenAI completion API. Default is 600 seconds."""
    max_retries: int = 1
    """Maximum number of retries to make when generating."""

    @root_validator()
    def validate_environment(cls, values: Dict) -> Dict:
        """Validate that api key and python package exists in environment."""
        try:
            import openai

            values["client"] = openai.Completion
        except ImportError:
            raise ValueError(
                "Could not import openai python package. "
                "Please install it with `pip install openai`."
            )
        if values["streaming"] and values["n"] > 1:
            raise ValueError("Cannot stream results when n > 1.")
        if values["streaming"] and values["best_of"] > 1:
            raise ValueError("Cannot stream results when best_of > 1.")
        return values

    @property
    def _invocation_params(self) -> Dict[str, Any]:
        return {**super()._invocation_params, **{
            "api_type": self.openai_api_type,
            "api_base": self.openai_api_base,
            "api_version": self.openai_api_version,
            "api_key": self.openai_api_key,
            "organization": self.openai_organization if self.openai_organization else None,
        }}

    @property
    def _identifying_params(self) -> Mapping[str, Any]:
        return {**super()._identifying_params, **{
            "api_type": self.openai_api_type,
            "api_base": self.openai_api_base,
            "api_version": self.openai_api_version,
            "api_key": self.openai_api_key,
            "organization": self.openai_organization if self.openai_organization else None,
        }}

    def _generate(
        self,
        prompts: List[str],
        stop: Optional[List[str]] = None,
        run_manager: Optional[CallbackManagerForLLMRun] = None,
        **kwargs: Any,
    ) -> LLMResult:
        """Call out to OpenAI's endpoint with k unique prompts.

        Args:
            prompts: The prompts to pass into the model.
            stop: Optional list of stop words to use when generating.

        Returns:
            The full LLM output.

        Example:
            .. code-block:: python

                response = openai.generate(["Tell me a joke."])
        """
        params = self._invocation_params
        params = {**params, **kwargs}
        sub_prompts = self.get_sub_prompts(params, prompts, stop)
        choices = []
        token_usage: Dict[str, int] = {}
        # Get the token usage from the response.
        # Includes prompt, completion, and total tokens used.
        _keys = {"completion_tokens", "prompt_tokens", "total_tokens"}
        for _prompts in sub_prompts:
            if self.streaming:
                if len(_prompts) > 1:
                    raise ValueError("Cannot stream results with multiple prompts.")
                params["stream"] = True
                response = _streaming_response_template()
                for stream_resp in completion_with_retry(
                    self, prompt=_prompts, **params
                ):
                    if len(stream_resp["choices"]) > 0:
                        if run_manager:
                            run_manager.on_llm_new_token(
                                stream_resp["choices"][0]["text"],
                                verbose=self.verbose,
                                logprobs=stream_resp["choices"][0]["logprobs"],
                            )
                        _update_response(response, stream_resp)
                choices.extend(response["choices"])
            else:
                response = completion_with_retry(self, prompt=_prompts, **params)
                choices.extend(response["choices"])
            if not self.streaming:
                # Can't update token usage if streaming
                update_token_usage(_keys, response, token_usage)
        return self.create_llm_result(choices, prompts, token_usage)