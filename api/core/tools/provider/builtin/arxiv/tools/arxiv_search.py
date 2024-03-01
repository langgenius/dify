from typing import Any

from langchain.utilities import ArxivAPIWrapper
from pydantic import BaseModel, Field

from core.tools.entities.tool_entities import ToolInvokeMessage
from core.tools.tool.builtin_tool import BuiltinTool


class ArxivSearchInput(BaseModel):
    query: str = Field(..., description="Search query.")
    
class ArxivSearchTool(BuiltinTool):
    """
    A tool for searching articles on Arxiv.
    """
    def _invoke(self, user_id: str, tool_parameters: dict[str, Any]) -> ToolInvokeMessage | list[ToolInvokeMessage]:
        """
        Invokes the Arxiv search tool with the given user ID and tool parameters.

        Args:
            user_id (str): The ID of the user invoking the tool.
            tool_parameters (dict[str, Any]): The parameters for the tool, including the 'query' parameter.

        Returns:
            ToolInvokeMessage | list[ToolInvokeMessage]: The result of the tool invocation, which can be a single message or a list of messages.
        """
        query = tool_parameters.get('query', '')

        if not query:
            return self.create_text_message('Please input query')
        
        arxiv = ArxivAPIWrapper()
        
        response = arxiv.run(query)
        
        return self.create_text_message(self.summary(user_id=user_id, content=response))
