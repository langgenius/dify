from typing import List, Dict, Any, Optional

from langchain import LLMChain as LCLLMChain
from langchain.callbacks.manager import CallbackManagerForChainRun
from langchain.schema import LLMResult, Generation
from langchain.schema.language_model import BaseLanguageModel

from core.model_providers.models.entity.message import to_prompt_messages
from core.model_providers.models.llm.base import BaseLLM
from core.third_party.langchain.llms.fake import FakeLLM


class LLMChain(LCLLMChain):
    model_instance: BaseLLM
    """The language model instance to use."""
    llm: BaseLanguageModel = FakeLLM(response="")

    def generate(
        self,
        input_list: List[Dict[str, Any]],
        run_manager: Optional[CallbackManagerForChainRun] = None,
    ) -> LLMResult:
        """Generate LLM result from inputs."""
        prompts, stop = self.prep_prompts(input_list, run_manager=run_manager)
        messages = prompts[0].to_messages()
        prompt_messages = to_prompt_messages(messages)
        result = self.model_instance.run(
            messages=prompt_messages,
            stop=stop
        )

        generations = [
            [Generation(text=result.content)]
        ]

        return LLMResult(generations=generations)
