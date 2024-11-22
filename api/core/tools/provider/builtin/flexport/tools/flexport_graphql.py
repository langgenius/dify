from typing import Any, Union

from core.tools.entities.tool_entities import ToolInvokeMessage
from core.tools.tool.builtin_tool import BuiltinTool


class FlexportGrpahqlTool(BuiltinTool):
    def _invoke(
        self,
        user_id: str,
        tool_parameters: dict[str, Any],
    ) -> Union[ToolInvokeMessage, list[ToolInvokeMessage]]:
        """
        invoke tools
        """
        query = tool_parameters["query"]
        result_type = tool_parameters["result_type"]

        if result_type == "text":
            return self.create_text_message(text=result)
        return self.create_link_message(link=result)
