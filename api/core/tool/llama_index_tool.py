from typing import Dict

from langchain.tools import BaseTool
from llama_index.indices.base import BaseGPTIndex
from llama_index.langchain_helpers.agents import IndexToolConfig
from pydantic import Field

from core.callback_handler.index_tool_callback_handler import IndexToolCallbackHandler


class EnhanceLlamaIndexTool(BaseTool):
    """Tool for querying a LlamaIndex."""

    # NOTE: name/description still needs to be set
    index: BaseGPTIndex
    query_kwargs: Dict = Field(default_factory=dict)
    return_sources: bool = False
    callback_handler: IndexToolCallbackHandler

    @classmethod
    def from_tool_config(cls, tool_config: IndexToolConfig,
                         callback_handler: IndexToolCallbackHandler) -> "EnhanceLlamaIndexTool":
        """Create a tool from a tool config."""
        return_sources = tool_config.tool_kwargs.pop("return_sources", False)
        return cls(
            index=tool_config.index,
            callback_handler=callback_handler,
            name=tool_config.name,
            description=tool_config.description,
            return_sources=return_sources,
            query_kwargs=tool_config.index_query_kwargs,
            **tool_config.tool_kwargs,
        )

    def _run(self, tool_input: str) -> str:
        response = self.index.query(tool_input, **self.query_kwargs)
        self.callback_handler.on_tool_end(response)
        return str(response)

    async def _arun(self, tool_input: str) -> str:
        response = await self.index.aquery(tool_input, **self.query_kwargs)
        self.callback_handler.on_tool_end(response)
        return str(response)
