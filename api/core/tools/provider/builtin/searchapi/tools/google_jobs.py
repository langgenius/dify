from typing import Any, Union

import requests

from core.tools.entities.tool_entities import ToolInvokeMessage
from core.tools.tool.builtin_tool import BuiltinTool

SEARCH_API_URL = "https://www.searchapi.io/api/v1/search"


class SearchAPI:
    """
    SearchAPI tool provider.
    """

    def __init__(self, api_key: str) -> None:
        """Initialize SearchAPI tool provider."""
        self.searchapi_api_key = api_key

    def run(self, query: str, **kwargs: Any) -> str:
        """Run query through SearchAPI and parse result."""
        type = kwargs.get("result_type", "text")
        return self._process_response(self.results(query, **kwargs), type=type)

    def results(self, query: str, **kwargs: Any) -> dict:
        """Run query through SearchAPI and return the raw result."""
        params = self.get_params(query, **kwargs)
        response = requests.get(
            url=SEARCH_API_URL,
            params=params,
            headers={"Authorization": f"Bearer {self.searchapi_api_key}"},
        )
        response.raise_for_status()
        return response.json()

    def get_params(self, query: str, **kwargs: Any) -> dict[str, str]:
        """Get parameters for SearchAPI."""
        return {
            "engine": "google_jobs",
            "q": query,
            **{key: value for key, value in kwargs.items() if value not in [None, ""]},
        }

    @staticmethod
    def _process_response(res: dict, type: str) -> str:
        """Process response from SearchAPI."""
        if "error" in res:
            raise ValueError(f"Got error from SearchApi: {res['error']}")

        toret = ""
        if type == "text":
            if "jobs" in res and "title" in res["jobs"][0]:
                for item in res["jobs"]:
                    toret += (
                        "title: "
                        + item["title"]
                        + "\n"
                        + "company_name: "
                        + item["company_name"]
                        + "content: "
                        + item["description"]
                        + "\n"
                    )
            if toret == "":
                toret = "No good search result found"

        elif type == "link":
            if "jobs" in res and "apply_link" in res["jobs"][0]:
                for item in res["jobs"]:
                    toret += f"[{item['title']} - {item['company_name']}]({item['apply_link']})\n"
            else:
                toret = "No good search result found"
        return toret


class GoogleJobsTool(BuiltinTool):
    def _invoke(
        self,
        user_id: str,
        tool_parameters: dict[str, Any],
    ) -> Union[ToolInvokeMessage, list[ToolInvokeMessage]]:
        """
        Invoke the SearchApi tool.
        """
        query = tool_parameters["query"]
        result_type = tool_parameters["result_type"]
        is_remote = tool_parameters.get("is_remote")
        google_domain = tool_parameters.get("google_domain", "google.com")
        gl = tool_parameters.get("gl", "us")
        hl = tool_parameters.get("hl", "en")
        location = tool_parameters.get("location")

        ltype = 1 if is_remote else None

        api_key = self.runtime.credentials["searchapi_api_key"]
        result = SearchAPI(api_key).run(
            query, result_type=result_type, google_domain=google_domain, gl=gl, hl=hl, location=location, ltype=ltype
        )

        if result_type == "text":
            return self.create_text_message(text=result)
        return self.create_link_message(link=result)
