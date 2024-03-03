from typing import Any

from langchain.tools import PubmedQueryRun
from pydantic import BaseModel, Field

from core.tools.entities.tool_entities import ToolInvokeMessage
from core.tools.tool.builtin_tool import BuiltinTool


class PubMedInput(BaseModel):
    query: str = Field(..., description="Search query.")


class PubMedSearchTool(BuiltinTool):
    """
    Tool for performing a search using PubMed search engine.
    """

    def _invoke(self, user_id: str, tool_parameters: dict[str, Any]) -> ToolInvokeMessage | list[ToolInvokeMessage]:
        """
        Invoke the PubMed search tool.

        Args:
            user_id (str): The ID of the user invoking the tool.
            tool_parameters (dict[str, Any]): The parameters for the tool invocation.

        Returns:
            ToolInvokeMessage | list[ToolInvokeMessage]: The result of the tool invocation.
        """
        query = tool_parameters.get('query', '')

        if not query:
            return self.create_text_message('Please input query')

        tool = PubmedQueryRun(args_schema=PubMedInput)

        result = tool.run(query)

        return self.create_text_message(self.summary(user_id=user_id, content=result))
    