from typing import Any, Optional

from langchain import LLMChain as LCLLMChain
from langchain.callbacks.manager import CallbackManagerForChainRun
from langchain.schema import Generation, LLMResult
from langchain.schema.language_model import BaseLanguageModel

from core.entities.application_entities import ModelConfigEntity
from core.entities.message_entities import lc_messages_to_prompt_messages
from core.features.dataset_retrieval.agent.agent_llm_callback import AgentLLMCallback
from core.features.dataset_retrieval.agent.fake_llm import FakeLLM
from core.model_manager import ModelInstance


class LLMChain(LCLLMChain):
    model_config: ModelConfigEntity
    """The language model instance to use."""
    llm: BaseLanguageModel = FakeLLM(response="")
    parameters: dict[str, Any] = {}
    agent_llm_callback: Optional[AgentLLMCallback] = None

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
            callbacks=[self.agent_llm_callback] if self.agent_llm_callback else None,
            model_parameters=self.parameters
        )

        generations = [
            [Generation(text=result.message.content)]
        ]

        return LLMResult(generations=generations)
