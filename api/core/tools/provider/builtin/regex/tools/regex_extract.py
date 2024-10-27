import re
from typing import Any, Union

from core.tools.entities.tool_entities import ToolInvokeMessage
from core.tools.tool.builtin_tool import BuiltinTool


class RegexExpressionTool(BuiltinTool):
    def _invoke(self,
                user_id: str,
               tool_parameters: dict[str, Any],
        ) ->  Union[ToolInvokeMessage, list[ToolInvokeMessage]]:
        """
            invoke tools
        """
        # get expression
        content = tool_parameters.get('content', '').strip()
        if not content:
            return self.create_text_message('Invalid content')
        expression = tool_parameters.get('expression', '').strip()
        if not expression:
            return self.create_text_message('Invalid expression')
        try:
            result = re.findall(expression, content)
            return self.create_text_message(str(result))
        except Exception as e:
            return self.create_text_message(f'Failed to extract result, error: {str(e)}')