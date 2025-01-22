from typing import Any

from linkup import LinkupClient

from core.tools.entities.tool_entities import ToolInvokeMessage
from core.tools.tool.builtin_tool import BuiltinTool


class LinkupAnswerTool(BuiltinTool):

    def _invoke(self, 
                user_id: str,
                tool_parameters: dict[str, Any], 
        ) -> ToolInvokeMessage | list[ToolInvokeMessage]:
        """
        Invoke the tool.
        """
        api_key = self.runtime.credentials.get('linkup_api_key', None)
        client = LinkupClient(api_key=api_key)
        query = tool_parameters.get('query', '')
        depth = tool_parameters.get('depth', '')
        try:
            response = client.search(
                query=query,
                depth=depth,
                output_type="sourcedAnswer"
            )
            output_line = []
            output_line.append(response.answer)
            for source in response.sources:
                output_line.append(f"{source.name} ({source.url}) {source.snippet}")
            formatted_output = "\n".join(output_line)
            return self.create_text_message(formatted_output)
        except Exception as e:
            return str(e)
