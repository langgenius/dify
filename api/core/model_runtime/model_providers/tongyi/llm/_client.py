from typing import Any, Optional

from langchain.callbacks.manager import CallbackManagerForLLMRun
from langchain.llms import Tongyi
from langchain.llms.tongyi import generate_with_retry, stream_generate_with_retry
from langchain.schema import Generation, LLMResult


class EnhanceTongyi(Tongyi):
    @property
    def _default_params(self) -> dict[str, Any]:
        """Get the default parameters for calling OpenAI API."""
        normal_params = {
            "top_p": self.top_p,
            "api_key": self.dashscope_api_key
        }

        return {**normal_params, **self.model_kwargs}

    def _generate(
        self,
        prompts: list[str],
        stop: Optional[list[str]] = None,
        run_manager: Optional[CallbackManagerForLLMRun] = None,
        **kwargs: Any,
    ) -> LLMResult:
        generations = []
        params: dict[str, Any] = {
            **{"model": self.model_name},
            **self._default_params,
            **kwargs,
        }
        if self.streaming:
            if len(prompts) > 1:
                raise ValueError("Cannot stream results with multiple prompts.")
            params["stream"] = True
            text = ''
            for stream_resp in stream_generate_with_retry(
                self, prompt=prompts[0], **params
            ):
                if not generations:
                    current_text = stream_resp["output"]["text"]
                else:
                    current_text = stream_resp["output"]["text"][len(text):]

                text = stream_resp["output"]["text"]

                generations.append(
                    [
                        Generation(
                            text=current_text,
                            generation_info=dict(
                                finish_reason=stream_resp["output"]["finish_reason"],
                            ),
                        )
                    ]
                )

                if run_manager:
                    run_manager.on_llm_new_token(
                        current_text,
                        verbose=self.verbose,
                        logprobs=None,
                    )
        else:
            for prompt in prompts:
                completion = generate_with_retry(
                    self,
                    prompt=prompt,
                    **params,
                )
                generations.append(
                    [
                        Generation(
                            text=completion["output"]["text"],
                            generation_info=dict(
                                finish_reason=completion["output"]["finish_reason"],
                            ),
                        )
                    ]
                )
        return LLMResult(generations=generations)
