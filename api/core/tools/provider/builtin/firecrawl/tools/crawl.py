from typing import Any

from core.tools.entities.tool_entities import ToolInvokeMessage
from core.tools.provider.builtin.firecrawl.firecrawl_appx import FirecrawlApp, get_array_params, get_json_params
from core.tools.tool.builtin_tool import BuiltinTool


class CrawlTool(BuiltinTool):
    def _invoke(self, user_id: str, tool_parameters: dict[str, Any]) -> ToolInvokeMessage:
        """
        the api doc:
        https://docs.firecrawl.dev/api-reference/endpoint/crawl
        """
        app = FirecrawlApp(
            api_key=self.runtime.credentials["firecrawl_api_key"], base_url=self.runtime.credentials["base_url"]
        )

        scrapeOptions = {}
        payload = {}

        wait_for_results = tool_parameters.get("wait_for_results", True)

        payload["excludePaths"] = get_array_params(tool_parameters, "excludePaths")
        payload["includePaths"] = get_array_params(tool_parameters, "includePaths")
        payload["maxDepth"] = tool_parameters.get("maxDepth")
        payload["ignoreSitemap"] = tool_parameters.get("ignoreSitemap", False)
        payload["limit"] = tool_parameters.get("limit", 5)
        payload["allowBackwardLinks"] = tool_parameters.get("allowBackwardLinks", False)
        payload["allowExternalLinks"] = tool_parameters.get("allowExternalLinks", False)
        payload["webhook"] = tool_parameters.get("webhook")

        scrapeOptions["formats"] = get_array_params(tool_parameters, "formats")
        scrapeOptions["headers"] = get_json_params(tool_parameters, "headers")
        scrapeOptions["includeTags"] = get_array_params(tool_parameters, "includeTags")
        scrapeOptions["excludeTags"] = get_array_params(tool_parameters, "excludeTags")
        scrapeOptions["onlyMainContent"] = tool_parameters.get("onlyMainContent", False)
        scrapeOptions["waitFor"] = tool_parameters.get("waitFor", 0)
        scrapeOptions = {k: v for k, v in scrapeOptions.items() if v not in {None, ""}}
        payload["scrapeOptions"] = scrapeOptions or None

        payload = {k: v for k, v in payload.items() if v not in {None, ""}}

        crawl_result = app.crawl_url(url=tool_parameters["url"], wait=wait_for_results, **payload)

        return self.create_json_message(crawl_result)
