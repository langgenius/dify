import json
from typing import Any, Union
from urllib.parse import urlparse

from core.tools.entities.tool_entities import ToolInvokeMessage
from core.tools.provider.builtin.aliyuque.tools.base import AliYuqueTool
from core.tools.tool.builtin_tool import BuiltinTool


class AliYuqueDescribeDocumentContentTool(AliYuqueTool, BuiltinTool):
    def _invoke(
        self, user_id: str, tool_parameters: dict[str, Any]
    ) -> Union[ToolInvokeMessage, list[ToolInvokeMessage]]:
        new_params = {**tool_parameters}
        token = new_params.pop("token")
        if not token or token.lower() == "none":
            token = self.runtime.credentials.get("token", None)
        if not token:
            raise Exception("token is required")
        new_params = {**tool_parameters}
        url = new_params.pop("url")
        if not url or not url.startswith("http"):
            raise Exception("url is not valid")

        parsed_url = urlparse(url)
        path_parts = parsed_url.path.strip("/").split("/")
        if len(path_parts) < 3:
            raise Exception("url is not correct")
        doc_id = path_parts[-1]
        book_slug = path_parts[-2]
        group_id = path_parts[-3]

        new_params["group_login"] = group_id
        new_params["book_slug"] = book_slug
        index_page = json.loads(
            self.request("GET", token, new_params, "/api/v2/repos/{group_login}/{book_slug}/index_page")
        )
        book_id = index_page.get("data", {}).get("book", {}).get("id")
        if not book_id:
            raise Exception(f"can not parse book_id from {index_page}")

        new_params["book_id"] = book_id
        new_params["id"] = doc_id
        data = self.request("GET", token, new_params, "/api/v2/repos/{book_id}/docs/{id}")
        data = json.loads(data)
        body_only = tool_parameters.get("body_only") or ""
        if body_only.lower() == "true":
            return self.create_text_message(data.get("data").get("body"))
        else:
            raw = data.get("data")
            del raw["body_lake"]
            del raw["body_html"]
            return self.create_text_message(json.dumps(data))
