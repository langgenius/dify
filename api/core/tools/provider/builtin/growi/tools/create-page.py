from typing import Any, Dict, List, Union
from core.tools.tool.builtin_tool import BuiltinTool
from core.tools.entities.tool_entities import ToolInvokeMessage

import requests


class CreatePageTool(BuiltinTool):
    def _invoke(self, user_id: str, tool_parameters: Dict[str, Any]) -> Union[ToolInvokeMessage, List[ToolInvokeMessage]]:
        path = tool_parameters["path"]
        body = tool_parameters["body"]

        growi_url = self.runtime.credentials["growi_url"]
        access_token = self.runtime.credentials["access_token"]
        
        endpoint = f"{growi_url}/_api/v3/page"

        data = {
            "access_token": access_token,
            "path": path,
            "body": body
        }

        res = requests.post(endpoint, data=data)
    
        return self.create_json_message(res.json())