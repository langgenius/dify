import enum
from typing import Union, Optional

from langchain.agents import BaseSingleActionAgent, BaseMultiActionAgent
from langchain.base_language import BaseLanguageModel
from langchain.callbacks.manager import Callbacks
from langchain.tools import BaseTool

from core.agent.agent.openai_function_call import AutoSummarizingOpenAIFunctionCallAgent
from core.agent.agent.openai_multi_function_call import AutoSummarizingOpenMultiAIFunctionCallAgent
from core.agent.agent.structured_chat import AutoSummarizingStructuredChatAgent
from langchain.agents import AgentExecutor as LCAgentExecutor
from core.memory.read_only_conversation_token_db_buffer_shared_memory import \
    ReadOnlyConversationTokenDBBufferSharedMemory


class PlanningStrategy(str, enum.Enum):
    REACT = 'react'
    FUNCTION_CALL = 'function_call'
    MULTI_FUNCTION_CALL = 'multi_function_call'


class AgentExecutor:
    def __init__(self, strategy: PlanningStrategy, llm: BaseLanguageModel, tools: list[BaseTool],
                 summary_llm: BaseLanguageModel, memory: ReadOnlyConversationTokenDBBufferSharedMemory,
                 callbacks: Callbacks = None, max_iterations: int = 6, max_execution_time: Optional[float] = None,
                 early_stopping_method: str = "generate"):
        self.strategy = strategy
        self.llm = llm
        self.tools = tools
        self.summary_llm = summary_llm
        self.memory = memory
        self.callbacks = callbacks

        self.agent = self._init_agent(strategy, llm, tools, memory, callbacks)

        self.max_iterations = max_iterations
        self.max_execution_time = max_execution_time
        self.early_stopping_method = early_stopping_method
        # `generate` will continue to complete the last inference after reaching the iteration limit or request time limit

        # summary_llm: StreamableChatOpenAI = LLMBuilder.to_llm(
        #     tenant_id=tenant_id,
        #     model_name='gpt-3.5-turbo-16k',
        #     max_tokens=300
        # )

    def _init_agent(self, strategy: PlanningStrategy, llm: BaseLanguageModel, tools: list[BaseTool],
                    memory: ReadOnlyConversationTokenDBBufferSharedMemory, callbacks: Callbacks = None) \
            -> Union[BaseSingleActionAgent | BaseMultiActionAgent]:
        if strategy == PlanningStrategy.REACT:
            agent = AutoSummarizingStructuredChatAgent.from_llm_and_tools(
                llm=llm,
                tools=tools,
                summary_llm=self.summary_llm,
                verbose=True
            )
        elif strategy == PlanningStrategy.FUNCTION_CALL:
            agent = AutoSummarizingOpenAIFunctionCallAgent(
                llm=llm,
                tools=tools,
                extra_prompt_messages=memory.buffer,  # used for read chat histories memory
                summary_llm=self.summary_llm,
                verbose=True
            )
        elif strategy == PlanningStrategy.MULTI_FUNCTION_CALL:
            agent = AutoSummarizingOpenMultiAIFunctionCallAgent(
                llm=llm,
                tools=tools,
                extra_prompt_messages=memory.buffer,  # used for read chat histories memory
                summary_llm=self.summary_llm,
                verbose=True
            )

        return agent

    def should_use_agent(self, query: str) -> bool:
        return self.agent.should_use_agent(query)

    def run(self, query: str) -> str:
        agent_executor = LCAgentExecutor.from_agent_and_tools(
            agent=self.agent,
            tools=self.tools,
            memory=self.memory,
            max_iterations=self.max_iterations,
            max_execution_time=self.max_execution_time,
            early_stopping_method=self.early_stopping_method,
            verbose=True
        )

        # run agent
        result = agent_executor.run(
            query,
            callbacks=self.callbacks
        )

        return result
