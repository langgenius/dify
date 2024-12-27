import logging
from typing import Any, Union

import numexpr as ne  # type: ignore

from core.tools.entities.tool_entities import ToolInvokeMessage
from core.tools.tool.builtin_tool import BuiltinTool


class EvaluateExpressionTool(BuiltinTool):
    def _invoke(
        self,
        user_id: str,
        tool_parameters: dict[str, Any],
    ) -> Union[ToolInvokeMessage, list[ToolInvokeMessage]]:
        """
        invoke tools
        """
        # get expression
        expression = tool_parameters.get("expression", "").strip()
        if not expression:
            return self.create_text_message("Invalid expression")

        try:
            result = ne.evaluate(expression)
            result_str = str(result)
        except Exception as e:
            logging.exception(f"Error evaluating expression: {expression}")
            return self.create_text_message(f"Invalid expression: {expression}, error: {str(e)}")
        return self.create_text_message(f'The result of the expression "{expression}" is {result_str}')
