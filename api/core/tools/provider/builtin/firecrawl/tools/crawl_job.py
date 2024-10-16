from typing import Any

from core.tools.entities.tool_entities import ToolInvokeMessage
from core.tools.provider.builtin.firecrawl.firecrawl_appx import FirecrawlApp
from core.tools.tool.builtin_tool import BuiltinTool


class CrawlJobTool(BuiltinTool):
    def _invoke(self, user_id: str, tool_parameters: dict[str, Any]) -> ToolInvokeMessage:
        app = FirecrawlApp(
            api_key=self.runtime.credentials["firecrawl_api_key"], base_url=self.runtime.credentials["base_url"]
        )
        operation = tool_parameters.get("operation", "get")
        if operation == "get":
            result = app.check_crawl_status(job_id=tool_parameters["job_id"])
        elif operation == "cancel":
            result = app.cancel_crawl_job(job_id=tool_parameters["job_id"])
        else:
            raise ValueError(f"Invalid operation: {operation}")

        return self.create_json_message(result)
