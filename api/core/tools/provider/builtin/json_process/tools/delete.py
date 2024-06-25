import json
from typing import Any, Union

from jsonpath_ng import parse

from core.tools.entities.tool_entities import ToolInvokeMessage
from core.tools.tool.builtin_tool import BuiltinTool


class JSONDeleteTool(BuiltinTool):
    def _invoke(self,
                user_id: str,
                tool_parameters: dict[str, Any],
                ) -> Union[ToolInvokeMessage, list[ToolInvokeMessage]]:
        """
        Invoke the JSON delete tool
        """
        # Get content
        content = tool_parameters.get('content', '')
        if not content:
            return self.create_text_message('Invalid parameter content')
        
        # Get query
        query = tool_parameters.get('query', '')
        if not query:
            return self.create_text_message('Invalid parameter query')
        
        try:
            result = self._delete(content, query)
            return self.create_text_message(str(result))
        except Exception as e:
            return self.create_text_message(f'Failed to delete JSON content: {str(e)}')

    def _delete(self, origin_json: str, query: str) -> str:
        try:
            input_data = json.loads(origin_json)
            expr = parse('$.' + query.lstrip('$.'))  # Ensure query path starts with $
            
            matches = expr.find(input_data)
            
            if not matches:
                return json.dumps(input_data, ensure_ascii=True)  # No changes if no matches found
            
            for match in matches:
                if isinstance(match.context.value, dict):
                    # Delete key from dictionary
                    del match.context.value[match.path.fields[-1]]
                elif isinstance(match.context.value, list):
                    # Remove item from list
                    match.context.value.remove(match.value)
                else:
                    # For other cases, we might want to set to None or remove the parent key
                    parent = match.context.parent
                    if parent:
                        del parent.value[match.path.fields[-1]]
            
            return json.dumps(input_data, ensure_ascii=True)
        except Exception as e:
            raise Exception(f"Delete operation failed: {str(e)}")