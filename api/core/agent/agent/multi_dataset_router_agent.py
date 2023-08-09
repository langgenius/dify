from typing import Tuple, List, Any, Union, Sequence, Optional, cast

from langchain.agents import OpenAIFunctionsAgent, BaseSingleActionAgent
from langchain.callbacks.base import BaseCallbackManager
from langchain.callbacks.manager import Callbacks
from langchain.prompts.chat import BaseMessagePromptTemplate
from langchain.schema import AgentAction, AgentFinish, SystemMessage
from langchain.schema.language_model import BaseLanguageModel
from langchain.tools import BaseTool

from core.model_providers.models.llm.base import BaseLLM
from core.tool.dataset_retriever_tool import DatasetRetrieverTool


class MultiDatasetRouterAgent(OpenAIFunctionsAgent):
    """
    An Multi Dataset Retrieve Agent driven by Router.
    """
    model_instance: BaseLLM

    class Config:
        """Configuration for this pydantic object."""

        arbitrary_types_allowed = True

    def should_use_agent(self, query: str):
        """
        return should use agent

        :param query:
        :return:
        """
        return True

    def plan(
        self,
        intermediate_steps: List[Tuple[AgentAction, str]],
        callbacks: Callbacks = None,
        **kwargs: Any,
    ) -> Union[AgentAction, AgentFinish]:
        """Given input, decided what to do.

        Args:
            intermediate_steps: Steps the LLM has taken to date, along with observations
            **kwargs: User inputs.

        Returns:
            Action specifying what tool to use.
        """
        if len(self.tools) == 0:
            return AgentFinish(return_values={"output": ''}, log='')
        elif len(self.tools) == 1:
            tool = next(iter(self.tools))
            tool = cast(DatasetRetrieverTool, tool)
            rst = tool.run(tool_input={'dataset_id': tool.dataset_id, 'query': kwargs['input']})
            return AgentFinish(return_values={"output": rst}, log=rst)

        if intermediate_steps:
            _, observation = intermediate_steps[-1]
            return AgentFinish(return_values={"output": observation}, log=observation)

        return super().plan(intermediate_steps, callbacks, **kwargs)

    async def aplan(
            self,
            intermediate_steps: List[Tuple[AgentAction, str]],
            callbacks: Callbacks = None,
            **kwargs: Any,
    ) -> Union[AgentAction, AgentFinish]:
        raise NotImplementedError()

    @classmethod
    def from_llm_and_tools(
            cls,
            llm: BaseLanguageModel,
            tools: Sequence[BaseTool],
            callback_manager: Optional[BaseCallbackManager] = None,
            extra_prompt_messages: Optional[List[BaseMessagePromptTemplate]] = None,
            system_message: Optional[SystemMessage] = SystemMessage(
                content="You are a helpful AI assistant."
            ),
            **kwargs: Any,
    ) -> BaseSingleActionAgent:
        return super().from_llm_and_tools(
            llm=llm,
            tools=tools,
            callback_manager=callback_manager,
            extra_prompt_messages=extra_prompt_messages,
            system_message=system_message,
            **kwargs,
        )
