
from collections.abc import Generator
from typing import Any, Optional

from core.tools.builtin_tool.tool import BuiltinTool
from core.tools.entities.tool_entities import ToolInvokeMessage


class AlertRuleTool(BuiltinTool):
    def _invoke(
        self,
        user_id: str,
        tool_parameters: dict[str, Any],
        conversation_id: Optional[str] = None,
        app_id: Optional[str] = None,
        message_id: Optional[str] = None,
    ) -> Generator[ToolInvokeMessage, None, None]:
        """
        invoke tools
        """
        # data = tool_parameters.get("data")
        rule = tool_parameters.get("rule")
        # res = f'{rule}\n{data}'
        # list = json.dumps({
        #     'type': 'alert',
        #     'display': False,
        #     'data': res,
        # })
        yield self.create_text_message(rule)