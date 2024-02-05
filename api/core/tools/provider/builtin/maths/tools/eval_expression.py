import logging
from datetime import datetime, timezone
from typing import Any, Dict, List, Union

from core.tools.entities.tool_entities import ToolInvokeMessage
from core.tools.tool.builtin_tool import BuiltinTool
from pytz import timezone as pytz_timezone
import numexpr as ne

class EvaluateExpressionTool(BuiltinTool):
    def _invoke(self, 
                user_id: str,
               tool_parameters: Dict[str, Any], 
        ) -> Union[ToolInvokeMessage, List[ToolInvokeMessage]]:
        """
            invoke tools
        """
        # get expression
        expression = tool_parameters.get('expression', '').strip()
        if not expression:
            return self.create_text_message('Invalid expression')

        try:
            result = ne.evaluate(expression)
            result_str = str(result)
        except Exception as e:
            logging.exception(f'Error evaluating expression: {expression}')
            return self.create_text_message(f'Invalid expression: {expression}, error: {str(e)}')
        return self.create_text_message(f'The result of the expression "{expression}" is {result_str}')