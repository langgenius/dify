from typing import Any, ClassVar

from duckduckgo_search import DDGS

from core.tools.entities.tool_entities import ToolInvokeMessage
from core.tools.tool.builtin_tool import BuiltinTool


class DuckDuckGoVideoSearchTool(BuiltinTool):
    """
    Tool for performing a video search using DuckDuckGo search engine.
    """

    IFRAME_TEMPLATE: ClassVar[str] = """
<div style="position: relative; padding-bottom: 56.25%; height: 0; overflow: hidden; \
max-width: 100%; border-radius: 8px;">
    <iframe
        style="position: absolute; top: 0; left: 0; width: 100%; height: 100%;"
        src="{src}"
        frameborder="0"
        allowfullscreen>
    </iframe>
</div>"""

    def _invoke(self, user_id: str, tool_parameters: dict[str, Any]) -> list[ToolInvokeMessage]:
        query_dict = {
            "keywords": tool_parameters.get("query"),
            "region": tool_parameters.get("region", "wt-wt"),
            "safesearch": tool_parameters.get("safesearch", "moderate"),
            "timelimit": tool_parameters.get("timelimit"),
            "resolution": tool_parameters.get("resolution"),
            "duration": tool_parameters.get("duration"),
            "license_videos": tool_parameters.get("license_videos"),
            "max_results": tool_parameters.get("max_results"),
        }

        # Remove None values to use API defaults
        query_dict = {k: v for k, v in query_dict.items() if v is not None}

        # Get proxy URL from parameters
        proxy_url = tool_parameters.get("proxy_url", "").strip()

        response = DDGS().videos(**query_dict)

        # Create HTML result with embedded iframes
        markdown_result = "\n\n"
        json_result = []

        for res in response:
            title = res.get("title", "")
            embed_html = res.get("embed_html", "")
            description = res.get("description", "")
            content_url = res.get("content", "")

            # Handle TED.com videos
            if not embed_html and "ted.com/talks" in content_url:
                embed_url = content_url.replace("www.ted.com", "embed.ted.com")
                if proxy_url:
                    embed_url = f"{proxy_url}{embed_url}"
                embed_html = self.IFRAME_TEMPLATE.format(src=embed_url)

            # Original YouTube/other platform handling
            elif embed_html:
                embed_url = res.get("embed_url", "")
                if proxy_url and embed_url:
                    embed_url = f"{proxy_url}{embed_url}"
                embed_html = self.IFRAME_TEMPLATE.format(src=embed_url)

            markdown_result += f"{title}\n\n"
            markdown_result += f"{embed_html}\n\n"
            markdown_result += "---\n\n"

            json_result.append(self.create_json_message(res))

        return [self.create_text_message(markdown_result)] + json_result
