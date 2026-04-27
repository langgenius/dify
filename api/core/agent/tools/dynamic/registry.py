from collections.abc import Callable
from typing import Any


class DynamicToolRegistry:
    """
    Registry for dynamic tool injection in Dify agents.
    Allows injecting custom tool logic at runtime without service restarts.
    """

    def __init__(self):
        self._tools: dict[str, Callable] = {}

    def register_tool(self, name: str, func: Callable):
        self._tools[name] = func

    def get_tool(self, name: str) -> Callable:
        return self._tools.get(name)

    def execute_tool(self, name: str, **kwargs) -> Any:
        tool = self.get_tool(name)
        if not tool:
            raise ValueError(f"Tool {name} not found in dynamic registry.")
        return tool(**kwargs)
