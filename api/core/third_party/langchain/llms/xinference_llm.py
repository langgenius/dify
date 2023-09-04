from typing import Optional, List, Any, Union, Generator

from langchain.callbacks.manager import CallbackManagerForLLMRun
from langchain.llms import Xinference
from langchain.llms.utils import enforce_stop_tokens
from xinference.client import (
    RESTfulChatglmCppChatModelHandle,
    RESTfulChatModelHandle,
    RESTfulGenerateModelHandle,
)


class XinferenceLLM(Xinference):
    def _call(
        self,
        prompt: str,
        stop: Optional[List[str]] = None,
        run_manager: Optional[CallbackManagerForLLMRun] = None,
        **kwargs: Any,
    ) -> str:
        """Call the xinference model and return the output.

        Args:
            prompt: The prompt to use for generation.
            stop: Optional list of stop words to use when generating.
            generate_config: Optional dictionary for the configuration used for
                generation.

        Returns:
            The generated string by the model.
        """
        model = self.client.get_model(self.model_uid)

        if isinstance(model, RESTfulChatModelHandle):
            generate_config: "LlamaCppGenerateConfig" = kwargs.get(
                "generate_config", {}
            )

            if stop:
                generate_config["stop"] = stop

            if generate_config and generate_config.get("stream"):
                combined_text_output = ""
                for token in self._stream_generate(
                    model=model,
                    prompt=prompt,
                    run_manager=run_manager,
                    generate_config=generate_config,
                ):
                    combined_text_output += token
                return combined_text_output
            else:
                completion = model.chat(prompt=prompt, generate_config=generate_config)
                return completion["choices"][0]["message"]["content"]
        elif isinstance(model, RESTfulGenerateModelHandle):
            generate_config: "LlamaCppGenerateConfig" = kwargs.get(
                "generate_config", {}
            )

            if stop:
                generate_config["stop"] = stop

            if generate_config and generate_config.get("stream"):
                combined_text_output = ""
                for token in self._stream_generate(
                    model=model,
                    prompt=prompt,
                    run_manager=run_manager,
                    generate_config=generate_config,
                ):
                    combined_text_output += token
                return combined_text_output

            else:
                completion = model.generate(
                    prompt=prompt, generate_config=generate_config
                )
                return completion["choices"][0]["text"]
        elif isinstance(model, RESTfulChatglmCppChatModelHandle):
            generate_config: "ChatglmCppGenerateConfig" = kwargs.get(
                "generate_config", {}
            )

            if generate_config and generate_config.get("stream"):
                combined_text_output = ""
                for token in self._stream_generate(
                    model=model,
                    prompt=prompt,
                    run_manager=run_manager,
                    generate_config=generate_config,
                ):
                    combined_text_output += token
                completion = combined_text_output
            else:
                completion = model.chat(prompt=prompt, generate_config=generate_config)
                completion = completion["choices"][0]["message"]["content"]

            if stop is not None:
                completion = enforce_stop_tokens(completion, stop)

            return completion

    def _stream_generate(
        self,
        model: Union[
            "RESTfulGenerateModelHandle",
            "RESTfulChatModelHandle",
            "RESTfulChatglmCppChatModelHandle",
        ],
        prompt: str,
        run_manager: Optional[CallbackManagerForLLMRun] = None,
        generate_config: Optional[
            Union[
                "LlamaCppGenerateConfig",
                "PytorchGenerateConfig",
                "ChatglmCppGenerateConfig",
            ]
        ] = None,
    ) -> Generator[str, None, None]:
        """
        Args:
            prompt: The prompt to use for generation.
            model: The model used for generation.
            stop: Optional list of stop words to use when generating.
            generate_config: Optional dictionary for the configuration used for
                generation.

        Yields:
            A string token.
        """
        if isinstance(
            model, (RESTfulChatModelHandle, RESTfulChatglmCppChatModelHandle)
        ):
            streaming_response = model.chat(
                prompt=prompt, generate_config=generate_config
            )
        else:
            streaming_response = model.generate(
                prompt=prompt, generate_config=generate_config
            )

        for chunk in streaming_response:
            if isinstance(chunk, dict):
                choices = chunk.get("choices", [])
                if choices:
                    choice = choices[0]
                    if isinstance(choice, dict):
                        if "text" in choice:
                            token = choice.get("text", "")
                        elif "delta" in choice and "content" in choice["delta"]:
                            token = choice.get("delta").get("content")
                        else:
                            continue
                        log_probs = choice.get("logprobs")
                        if run_manager:
                            run_manager.on_llm_new_token(
                                token=token, verbose=self.verbose, log_probs=log_probs
                            )
                        yield token
