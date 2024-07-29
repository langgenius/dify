import json
from typing import Any, Union

from jsonpath_ng import parse

from core.tools.entities.tool_entities import ToolInvokeMessage
from core.tools.tool.builtin_tool import BuiltinTool


class JSONReplaceTool(BuiltinTool):
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

        # get query
        query = tool_parameters.get('query', '')
        if not query:
            return self.create_text_message('Invalid parameter query')

        # get replace value
        replace_value = tool_parameters.get('replace_value', '')
        if not replace_value:
            return self.create_text_message('Invalid parameter replace_value')

        # get replace model
        replace_model = tool_parameters.get('replace_model', '')
        if not replace_model:
            return self.create_text_message('Invalid parameter replace_model')

        ensure_ascii = tool_parameters.get('ensure_ascii', True)
        try:
            if replace_model == 'pattern':
                # get replace pattern
                replace_pattern = tool_parameters.get('replace_pattern', '')
                if not replace_pattern:
                    return self.create_text_message('Invalid parameter replace_pattern')
                result = self._replace_pattern(content, query, replace_pattern, replace_value, ensure_ascii)
            elif replace_model == 'key':
                result = self._replace_key(content, query, replace_value, ensure_ascii)
            elif replace_model == 'value':
                result = self._replace_value(content, query, replace_value, ensure_ascii)
            return self.create_text_message(str(result))
        except Exception:
            return self.create_text_message('Failed to replace JSON content')

    # Replace pattern
    def _replace_pattern(self, content: str, query: str, replace_pattern: str, replace_value: str, ensure_ascii: bool) -> str:
        try:
            input_data = json.loads(content)
            expr = parse(query)

            matches = expr.find(input_data)

            for match in matches:
                new_value = match.value.replace(replace_pattern, replace_value)
                match.full_path.update(input_data, new_value)

            return json.dumps(input_data, ensure_ascii=ensure_ascii)
        except Exception as e:
            return str(e)

    # Replace key
    def _replace_key(self, content: str, query: str, replace_value: str, ensure_ascii: bool) -> str:
        try:
            input_data = json.loads(content)
            expr = parse(query)

            matches = expr.find(input_data)

            for match in matches:
                parent = match.context.value
                if isinstance(parent, dict):
                    old_key = match.path.fields[0]
                    if old_key in parent:
                        value = parent.pop(old_key)
                        parent[replace_value] = value
                elif isinstance(parent, list):
                    for item in parent:
                        if isinstance(item, dict) and old_key in item:
                            value = item.pop(old_key)
                            item[replace_value] = value
            return json.dumps(input_data, ensure_ascii=ensure_ascii)
        except Exception as e:
            return str(e)

    # Replace value
    def _replace_value(self, content: str, query: str, replace_value: str, ensure_ascii: bool) -> str:
        try:
            input_data = json.loads(content)
            expr = parse(query)

            matches = expr.find(input_data)

            for match in matches:
                match.full_path.update(input_data, replace_value)

            return json.dumps(input_data, ensure_ascii=ensure_ascii)
        except Exception as e:
            return str(e)
