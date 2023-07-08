import enum

from langchain.base_language import BaseLanguageModel
from langchain.callbacks.manager import Callbacks
from langchain.schema import BaseMemory
from langchain.tools import BaseTool


class PlanningStrategy(str, enum.Enum):
    ROUTER = 'router'
    REACT = 'react'
    FUNCTION_CALL = 'function_call'


class AgentExecutor:
    def __init__(self, strategy: PlanningStrategy, model: BaseLanguageModel, tools: list[BaseTool],
                 memory: BaseMemory, callbacks: Callbacks = None,
                 max_iterations: int = 6, early_stopping_method: str = "generate"):
        self.strategy = strategy
        self.model = model
        self.tools = tools
        self.memory = memory
        self.callbacks = callbacks
        self.max_iterations = max_iterations
        self.early_stopping_method = early_stopping_method
        # `generate` will continue to complete the last inference after reaching the iteration limit or request time limit

    def should_use_agent(self, query: str) -> bool:
        pass

    def run(self, query: str) -> str:
        pass
