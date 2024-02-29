import logging
from typing import Optional, Union

from langchain.agents import AgentExecutor as LCAgentExecutor
from langchain.agents import BaseMultiActionAgent, BaseSingleActionAgent
from langchain.callbacks.manager import Callbacks
from langchain.tools import BaseTool
from pydantic import BaseModel, Extra

from core.entities.agent_entities import PlanningStrategy
from core.entities.application_entities import ModelConfigEntity
from core.entities.message_entities import prompt_messages_to_lc_messages
from core.features.dataset_retrieval.agent.agent_llm_callback import AgentLLMCallback
from core.features.dataset_retrieval.agent.multi_dataset_router_agent import MultiDatasetRouterAgent
from core.features.dataset_retrieval.agent.output_parser.structured_chat import StructuredChatOutputParser
from core.features.dataset_retrieval.agent.structed_multi_dataset_router_agent import StructuredMultiDatasetRouterAgent
from core.helper import moderation
from core.memory.token_buffer_memory import TokenBufferMemory
from core.model_runtime.errors.invoke import InvokeError
from core.tools.tool.dataset_retriever.dataset_multi_retriever_tool import DatasetMultiRetrieverTool
from core.tools.tool.dataset_retriever.dataset_retriever_tool import DatasetRetrieverTool


class AgentConfiguration(BaseModel):
    strategy: PlanningStrategy
    model_config: ModelConfigEntity
    tools: list[BaseTool]
    summary_model_config: Optional[ModelConfigEntity] = None
    memory: Optional[TokenBufferMemory] = None
    callbacks: Callbacks = None
    max_iterations: int = 6
    max_execution_time: Optional[float] = None
    early_stopping_method: str = "generate"
    agent_llm_callback: Optional[AgentLLMCallback] = None
    # `generate` will continue to complete the last inference after reaching the iteration limit or request time limit

    class Config:
        """Configuration for this pydantic object."""

        extra = Extra.forbid
        arbitrary_types_allowed = True


class AgentExecuteResult(BaseModel):
    strategy: PlanningStrategy
    output: Optional[str]
    configuration: AgentConfiguration


class AgentExecutor:
    def __init__(self, configuration: AgentConfiguration):
        self.configuration = configuration
        self.agent = self._init_agent()

    def _init_agent(self) -> Union[BaseSingleActionAgent, BaseMultiActionAgent]:
        if self.configuration.strategy == PlanningStrategy.ROUTER:
            self.configuration.tools = [t for t in self.configuration.tools
                                        if isinstance(t, DatasetRetrieverTool)
                                        or isinstance(t, DatasetMultiRetrieverTool)]
            agent = MultiDatasetRouterAgent.from_llm_and_tools(
                model_config=self.configuration.model_config,
                tools=self.configuration.tools,
                extra_prompt_messages=prompt_messages_to_lc_messages(self.configuration.memory.get_history_prompt_messages())
                if self.configuration.memory else None,
                verbose=True
            )
        elif self.configuration.strategy == PlanningStrategy.REACT_ROUTER:
            self.configuration.tools = [t for t in self.configuration.tools
                                        if isinstance(t, DatasetRetrieverTool)
                                        or isinstance(t, DatasetMultiRetrieverTool)]
            agent = StructuredMultiDatasetRouterAgent.from_llm_and_tools(
                model_config=self.configuration.model_config,
                tools=self.configuration.tools,
                output_parser=StructuredChatOutputParser(),
                verbose=True
            )
        else:
            raise NotImplementedError(f"Unknown Agent Strategy: {self.configuration.strategy}")

        return agent

    def should_use_agent(self, query: str) -> bool:
        return self.agent.should_use_agent(query)

    def run(self, query: str) -> AgentExecuteResult:
        moderation_result = moderation.check_moderation(
            self.configuration.model_config,
            query
        )

        if moderation_result:
            return AgentExecuteResult(
                output="I apologize for any confusion, but I'm an AI assistant to be helpful, harmless, and honest.",
                strategy=self.configuration.strategy,
                configuration=self.configuration
            )

        agent_executor = LCAgentExecutor.from_agent_and_tools(
            agent=self.agent,
            tools=self.configuration.tools,
            max_iterations=self.configuration.max_iterations,
            max_execution_time=self.configuration.max_execution_time,
            early_stopping_method=self.configuration.early_stopping_method,
            callbacks=self.configuration.callbacks
        )

        try:
            output = agent_executor.run(input=query)
        except InvokeError as ex:
            raise ex
        except Exception as ex:
            logging.exception("agent_executor run failed")
            output = None

        return AgentExecuteResult(
            output=output,
            strategy=self.configuration.strategy,
            configuration=self.configuration
        )
