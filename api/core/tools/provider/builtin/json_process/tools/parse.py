import json
from typing import Any, Union

from jsonpath_ng import parse

from core.tools.entities.tool_entities import ToolInvokeMessage
from core.tools.tool.builtin_tool import BuiltinTool


class JSONParseTool(BuiltinTool):
    def _invoke(self,
                user_id: str,
                tool_parameters: dict[str, Any],
                ) -> Union[ToolInvokeMessage, list[ToolInvokeMessage]]:
        """
            invoke tools
        """
        # get content
        content = tool_parameters.get('content', '')
        if not content:
            return self.create_text_message('Invalid parameter content')
        
        # get json filter
        json_filter = tool_parameters.get('json_filter', '')
        if not json_filter:
            return self.create_text_message('Invalid parameter json_filter')

        try:
            result = self._extract(content, json_filter)
            return self.create_text_message(str(result))
        except Exception:
            return self.create_text_message('Failed to extract JSON content')

    # Extract data from JSON content
    def _extract(self, content: str, json_filter: str) -> str:
        try:
            input_data = json.loads(content)
            expr = parse(json_filter)
            result = [match.value for match in expr.find(input_data)]
            
            if len(result) == 1:
                result = result[0]
            
            if isinstance(result, dict | list):
                return json.dumps(result, ensure_ascii=True)
            elif isinstance(result, str | int | float | bool) or result is None:
                return str(result)
            else:
                return repr(result)
        except Exception as e:
            return str(e)