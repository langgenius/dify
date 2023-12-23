from typing import List, Dict, Any, Optional, cast

from langchain import LLMChain as LCLLMChain
from langchain.callbacks.manager import CallbackManagerForChainRun
from langchain.schema import LLMResult, Generation
from langchain.schema.language_model import BaseLanguageModel

from core.entities.application_entities import ModelConfigEntity
from core.model_providers.models.entity.message import to_prompt_messages
from core.model_runtime.model_providers.__base.large_language_model import LargeLanguageModel
from core.third_party.langchain.llms.fake import FakeLLM


class LLMChain(LCLLMChain):
    model_config: ModelConfigEntity
    """The language model instance to use."""
    llm: BaseLanguageModel = FakeLLM(response="")
    parameters: Dict[str, Any] = {}

    def generate(
        self,
        input_list: List[Dict[str, Any]],
        run_manager: Optional[CallbackManagerForChainRun] = None,
    ) -> LLMResult:
        """Generate LLM result from inputs."""
        prompts, stop = self.prep_prompts(input_list, run_manager=run_manager)
        messages = prompts[0].to_messages()
        prompt_messages = to_prompt_messages(messages)

        model_instance = self.model_config.provider_model_bundle.model_instance
        model_instance = cast(LargeLanguageModel, model_instance)

        result = model_instance.invoke(
            model=self.model_config.model,
            credentials=self.model_config.credentials,
            prompt_messages=prompt_messages,
            stream=False,
            stop=stop,
            **self.parameters
        )

        generations = [
            [Generation(text=result.message.content)]
        ]

        return LLMResult(generations=generations)
