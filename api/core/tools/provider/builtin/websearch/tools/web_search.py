import typing
from urllib.parse import urlencode

import requests

from core.tools.entities.tool_entities import ToolInvokeMessage
from core.tools.tool.builtin_tool import BuiltinTool


class SerplyApi:
    """
    SerplyApi tool provider.
    """

    def __init__(self, api_key: str) -> None:
        """Initialize Serply Web Search Tool provider."""
        self.serply_api_key = api_key
        self.base_url = "https://api.serply.io/v1/search/"

    def run(self, query: str, **kwargs: typing.Any) -> str:
        """Run query through Serply and parse result."""
        params = {"q": query, "hl": kwargs.get("hl", "en"), "gl": kwargs.get("gl", "US"), "num": kwargs.get("num", 10)}
        location = kwargs.get("location", "US")

        headers = {
            "X-API-KEY": self.serply_api_key,
            "X-User-Agent": kwargs.get("device", "desktop"),
            "X-Proxy-Location": location,
            "User-Agent": "Dify",
        }

        url = f"{self.base_url}{urlencode(params)}"
        res = requests.get(
            url,
            headers=headers,
        )
        res = res.json()

        return self.parse_results(res)

    @staticmethod
    def parse_results(res: dict) -> str:
        """Process response from Serply Web Search."""
        results = res.get("results", [])
        if not results:
            raise ValueError(f"Got error from Serply: {res}")

        string = []
        for result in results:
            try:
                string.append(
                    "\n".join(
                        [
                            f"Title: {result['title']}",
                            f"Link: {result['link']}",
                            f"Description: {result['description'].strip()}",
                            "---",
                        ]
                    )
                )
            except KeyError:
                continue

        if related_questions := res.get("related_questions", []):
            string.append("---")
            string.append("Related Questions: ")
            string.append("\n".join(related_questions))

        content = "\n".join(string)
        return f"\nSearch results:\n {content}\n"


class WebSearchTool(BuiltinTool):
    def _invoke(
        self,
        user_id: str,
        tool_parameters: dict[str, typing.Any],
    ) -> typing.Union[ToolInvokeMessage, list[ToolInvokeMessage]]:
        """
        Invoke the SerplyApi tool.
        """
        query = tool_parameters["query"]
        num = tool_parameters.get("num", 10)
        gl = tool_parameters.get("gl", "us")
        hl = tool_parameters.get("hl", "en")
        location = tool_parameters.get("location", "None")

        api_key = self.runtime.credentials["serply_api_key"]
        result = SerplyApi(api_key).run(query=query, num=num, gl=gl, hl=hl, location=location)
        return self.create_text_message(text=result)
