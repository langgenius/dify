import json
from typing import Any, Union

from jsonpath_ng import parse

from core.tools.entities.tool_entities import ToolInvokeMessage
from core.tools.tool.builtin_tool import BuiltinTool


class JSONParseTool(BuiltinTool):
    def _invoke(
        self,
        user_id: str,
        tool_parameters: dict[str, Any],
    ) -> Union[ToolInvokeMessage, list[ToolInvokeMessage]]:
        """
        invoke tools
        """
        # get content
        content = tool_parameters.get("content", "")
        if not content:
            return self.create_text_message("Invalid parameter content")

        # get json filter
        json_filter = tool_parameters.get("json_filter", "")
        if not json_filter:
            return self.create_text_message("Invalid parameter json_filter")

        ensure_ascii = tool_parameters.get("ensure_ascii", True)
        try:
            json_string, json_objs = self._extract(content, json_filter, ensure_ascii)
            json_objs_dict = {str(index): item for index, item in enumerate(json_objs)}
            return [
                self.create_text_message(str(json_string)),
                self.create_json_message(json_objs_dict),
            ]
        except Exception as e:
            return self.create_text_message(f"Failed to extract JSON content: {str(e)}")

    # Extract data from JSON content
    def _extract(self, content: str, json_filter: str, ensure_ascii: bool) -> tuple[str, list]:
        try:
            input_data = json.loads(content)
            expr = parse(json_filter)
            result = [match.value for match in expr.find(input_data)]

            if not result:
                return ""

            if len(result) == 1:
                result = result[0]

            if isinstance(result, dict | list):
                json_string = json.dumps(result, ensure_ascii=ensure_ascii)
            elif isinstance(result, str | int | float | bool) or result is None:
                json_string = str(result)
            else:
                json_string = repr(result)

            return json_string, result
        except json.JSONDecodeError as e:
            raise ValueError(f"Invalid JSON content: {str(e)}")
        except Exception as e:
            raise ValueError(f"Error processing JSON content: {str(e)}")
