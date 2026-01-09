"""Agent patterns module.

This module provides different strategies for agent execution:
- FunctionCallStrategy: Uses native function/tool calling
- ReActStrategy: Uses ReAct (Reasoning + Acting) approach
- StrategyFactory: Factory for creating strategies based on model features
"""

from .base import AgentPattern
from .function_call import FunctionCallStrategy
from .react import ReActStrategy
from .strategy_factory import StrategyFactory

__all__ = [
    "AgentPattern",
    "FunctionCallStrategy",
    "ReActStrategy",
    "StrategyFactory",
]
