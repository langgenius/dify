from typing import Any

from core.tools.entities.tool_entities import ToolInvokeMessage
from core.tools.tool.builtin_tool import BuiltinTool
from core.tools.utils.lark_api_utils import LarkRequest


class GetWikiNodesTool(BuiltinTool):
    def _invoke(self, user_id: str, tool_parameters: dict[str, Any]) -> ToolInvokeMessage:
        app_id = self.runtime.credentials.get("app_id")
        app_secret = self.runtime.credentials.get("app_secret")
        client = LarkRequest(app_id, app_secret)

        space_id = tool_parameters.get("space_id")
        parent_node_token = tool_parameters.get("parent_node_token")
        page_token = tool_parameters.get("page_token")
        page_size = tool_parameters.get("page_size")

        res = client.get_wiki_nodes(space_id, parent_node_token, page_token, page_size)

        return self.create_json_message(res)
