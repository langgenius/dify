from typing import Any, Optional

from langchain import LLMChain as LCLLMChain
from langchain.callbacks.manager import CallbackManagerForChainRun
from langchain.schema import Generation, LLMResult
from langchain.schema.language_model import BaseLanguageModel

from core.app.entities.app_invoke_entities import ModelConfigWithCredentialsEntity
from core.entities.message_entities import lc_messages_to_prompt_messages
from core.model_manager import ModelInstance
from core.rag.retrieval.agent.fake_llm import FakeLLM


class LLMChain(LCLLMChain):
    model_config: ModelConfigWithCredentialsEntity
    """The language model instance to use."""
    llm: BaseLanguageModel = FakeLLM(response="")
    parameters: dict[str, Any] = {}

    def generate(
        self,
        input_list: list[dict[str, Any]],
        run_manager: Optional[CallbackManagerForChainRun] = None,
    ) -> LLMResult:
        """Generate LLM result from inputs."""
        prompts, stop = self.prep_prompts(input_list, run_manager=run_manager)
        messages = prompts[0].to_messages()
        prompt_messages = lc_messages_to_prompt_messages(messages)

        model_instance = ModelInstance(
            provider_model_bundle=self.model_config.provider_model_bundle,
            model=self.model_config.model,
        )

        result = model_instance.invoke_llm(
            prompt_messages=prompt_messages,
            stream=False,
            stop=stop,
            model_parameters=self.parameters
        )

        generations = [
            [Generation(text=result.message.content)]
        ]

        return LLMResult(generations=generations)
