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
        # get tool parameters
        content = tool_parameters.get("content", "")
        json_filter = tool_parameters.get("json_filter", "")
        ensure_ascii = tool_parameters.get("ensure_ascii", True)
        output_full_parsed_json = tool_parameters.get("output_full_parsed_json", True)

        if not content:
            return self.create_text_message("Invalid parameter content")

        try:
            final_result = []
            if output_full_parsed_json:
                # parse full json
                json_content = json.loads(content)

                # append json_messages to final_result
                if isinstance(json_content, list):
                    for item in json_content:
                        final_result.append(self.create_json_message(item))
                else:
                    final_result.append(self.create_json_message(json_content))

            if json_filter:
                filtered_result = self._extract(content, json_filter, ensure_ascii)
                final_result.append(self.create_text_message(str(filtered_result)))

            return final_result

        except Exception:
            return self.create_text_message("Failed to extract JSON content")

    # Extract data from JSON content
    def _extract(self, content: str, json_filter: str, ensure_ascii: bool) -> str:
        try:
            input_data = json.loads(content)
            expr = parse(json_filter)
            result = [match.value for match in expr.find(input_data)]

            if not result:
                return ""

            if len(result) == 1:
                result = result[0]

            if isinstance(result, dict | list):
                return json.dumps(result, ensure_ascii=ensure_ascii)
            elif isinstance(result, str | int | float | bool) or result is None:
                return str(result)
            else:
                return repr(result)
        except Exception as e:
            return str(e)
