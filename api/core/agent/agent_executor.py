import enum
from typing import Union, Optional

from langchain.agents import BaseSingleActionAgent, BaseMultiActionAgent
from langchain.base_language import BaseLanguageModel
from langchain.callbacks.manager import Callbacks
from langchain.memory.chat_memory import BaseChatMemory
from langchain.tools import BaseTool
from pydantic import BaseModel, Extra

from core.agent.agent.multi_dataset_router_agent import MultiDatasetRouterAgent
from core.agent.agent.openai_function_call import AutoSummarizingOpenAIFunctionCallAgent
from core.agent.agent.openai_multi_function_call import AutoSummarizingOpenMultiAIFunctionCallAgent
from core.agent.agent.structured_chat import AutoSummarizingStructuredChatAgent
from langchain.agents import AgentExecutor as LCAgentExecutor


class PlanningStrategy(str, enum.Enum):
    ROUTER = 'router'
    REACT = 'react'
    FUNCTION_CALL = 'function_call'
    MULTI_FUNCTION_CALL = 'multi_function_call'


class AgentConfiguration(BaseModel):
    strategy: PlanningStrategy
    llm: BaseLanguageModel
    tools: list[BaseTool]
    summary_llm: BaseLanguageModel
    memory: Optional[BaseChatMemory] = None
    callbacks: Callbacks = None
    max_iterations: int = 6
    max_execution_time: Optional[float] = None
    early_stopping_method: str = "generate"
    # `generate` will continue to complete the last inference after reaching the iteration limit or request time limit

    class Config:
        """Configuration for this pydantic object."""

        extra = Extra.forbid
        arbitrary_types_allowed = True


class AgentExecuteResult(BaseModel):
    strategy: PlanningStrategy
    output: str


class AgentExecutor:
    def __init__(self, configuration: AgentConfiguration):
        self.configuration = configuration
        self.agent = self._init_agent()

    def _init_agent(self) -> Union[BaseSingleActionAgent | BaseMultiActionAgent]:
        if self.configuration.strategy == PlanningStrategy.REACT:
            agent = AutoSummarizingStructuredChatAgent.from_llm_and_tools(
                llm=self.configuration.llm,
                tools=self.configuration.tools,
                summary_llm=self.configuration.summary_llm,
                verbose=True
            )
        elif self.configuration.strategy == PlanningStrategy.FUNCTION_CALL:
            agent = AutoSummarizingOpenAIFunctionCallAgent.from_llm_and_tools(
                llm=self.configuration.llm,
                tools=self.configuration.tools,
                extra_prompt_messages=self.configuration.memory.buffer if self.configuration.memory else None,  # used for read chat histories memory
                summary_llm=self.configuration.summary_llm,
                verbose=True
            )
        elif self.configuration.strategy == PlanningStrategy.MULTI_FUNCTION_CALL:
            agent = AutoSummarizingOpenMultiAIFunctionCallAgent.from_llm_and_tools(
                llm=self.configuration.llm,
                tools=self.configuration.tools,
                extra_prompt_messages=self.configuration.memory.buffer if self.configuration.memory else None,  # used for read chat histories memory
                summary_llm=self.configuration.summary_llm,
                verbose=True
            )
        elif self.configuration.strategy == PlanningStrategy.ROUTER:
            agent = MultiDatasetRouterAgent.from_llm_and_tools(
                llm=self.configuration.llm,
                tools=self.configuration.tools,
                extra_prompt_messages=self.configuration.memory.buffer if self.configuration.memory else None,
                verbose=True
            )
        else:
            raise NotImplementedError(f"Unknown Agent Strategy: {self.configuration.strategy}")

        return agent

    def should_use_agent(self, query: str) -> bool:
        return self.agent.should_use_agent(query)

    def run(self, query: str) -> AgentExecuteResult:
        agent_executor = LCAgentExecutor.from_agent_and_tools(
            agent=self.agent,
            tools=self.configuration.tools,
            memory=self.configuration.memory,
            max_iterations=self.configuration.max_iterations,
            max_execution_time=self.configuration.max_execution_time,
            early_stopping_method=self.configuration.early_stopping_method,
            verbose=True
        )

        output = agent_executor.run(query)

        return AgentExecuteResult(
            output=output,
            strategy=self.configuration.strategy
        )
