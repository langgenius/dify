from linkup import LinkupClient
from typing import Any, Union
from typing import Any, List, Union
from core.tools.entities.tool_entities import ToolInvokeMessage
from core.tools.tool.builtin_tool import BuiltinTool

class LinkupSearchTool(BuiltinTool):


    def _invoke(self, 
                user_id: str,
               tool_parameters: dict[str, Any], 
        ) -> Union[ToolInvokeMessage, List[ToolInvokeMessage]]:
        
        """
        Invoke the tool.
        """
        
        api_key_value = self.runtime.credentials.get('linkup_api_key', None)
        client = LinkupClient(api_key=api_key_value)
        query = tool_parameters.get('query', '')
        depth = tool_parameters.get('depth', '')
        
        try:
            response = client.search(
                query=query,
                depth=depth,
                output_type="searchResults"
            )
            output_line = []
            for result in response.results:
                output_line.append(f"{result.name} ({result.url}) {result.content}")
            formatted_output = "\n".join(output_line)
            return self.create_text_message(formatted_output)
        except Exception as e:
            return str(e)

