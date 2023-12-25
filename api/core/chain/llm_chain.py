from typing import List, Dict, Any, Optional

from langchain import LLMChain as LCLLMChain
from langchain.callbacks.manager import CallbackManagerForChainRun
from langchain.schema import LLMResult, Generation
from langchain.schema.language_model import BaseLanguageModel

from core.entities.application_entities import ModelConfigEntity
from core.model_manager import ModelInstance
from core.entities.message_entities import lc_messages_to_prompt_messages
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
        prompt_messages = lc_messages_to_prompt_messages(messages)

        model_instance = ModelInstance(
            provider_model_bundle=self.model_config.provider_model_bundle,
            model=self.model_config.model,
        )

        result = model_instance.invoke_llm(
            prompt_messages=prompt_messages,
            stream=False,
            stop=stop,
            **self.parameters
        )

        generations = [
            [Generation(text=result.message.content)]
        ]

        return LLMResult(generations=generations)
