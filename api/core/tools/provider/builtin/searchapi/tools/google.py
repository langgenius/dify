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
            "engine": "google",
            "q": query,
            **{key: value for key, value in kwargs.items() if value not in [None, ""]},
        }

    @staticmethod
    def _process_response(res: dict, type: str) -> str:
        """Process response from SearchAPI."""
        if "error" in res.keys():
            raise ValueError(f"Got error from SearchApi: {res['error']}")

        toret = ""
        if type == "text":
            if "answer_box" in res.keys() and "answer" in res["answer_box"].keys():
                toret += res["answer_box"]["answer"] + "\n"
            if "answer_box" in res.keys() and "snippet" in res["answer_box"].keys():
                toret += res["answer_box"]["snippet"] + "\n"
            if "knowledge_graph" in res.keys() and "description" in res["knowledge_graph"].keys():
                toret += res["knowledge_graph"]["description"] + "\n"
            if "organic_results" in res.keys() and "snippet" in res["organic_results"][0].keys():
                for item in res["organic_results"]:
                    toret += "content: " + item["snippet"] + "\n" + "link: " + item["link"] + "\n"
            if toret == "":
                toret = "No good search result found"

        elif type == "link":
            if "answer_box" in res.keys() and "organic_result" in res["answer_box"].keys():
                if "title" in res["answer_box"]["organic_result"].keys():
                    toret = f"[{res['answer_box']['organic_result']['title']}]({res['answer_box']['organic_result']['link']})\n"
            elif "organic_results" in res.keys() and "link" in res["organic_results"][0].keys():
                toret = ""
                for item in res["organic_results"]:
                    toret += f"[{item['title']}]({item['link']})\n"
            elif "related_questions" in res.keys() and "link" in res["related_questions"][0].keys():
                toret = ""
                for item in res["related_questions"]:
                    toret += f"[{item['title']}]({item['link']})\n"
            elif "related_searches" in res.keys() and "link" in res["related_searches"][0].keys():
                toret = ""
                for item in res["related_searches"]:
                    toret += f"[{item['title']}]({item['link']})\n"
            else:
                toret = "No good search result found"
        return toret

class GoogleTool(BuiltinTool):
    def _invoke(self,
                user_id: str,
                tool_parameters: dict[str, Any],
        ) -> Union[ToolInvokeMessage, list[ToolInvokeMessage]]:
        """
        Invoke the SearchApi tool.
        """
        query = tool_parameters['query']
        result_type = tool_parameters['result_type']
        num = tool_parameters.get("num", 10)
        google_domain = tool_parameters.get("google_domain", "google.com")
        gl = tool_parameters.get("gl", "us")
        hl = tool_parameters.get("hl", "en")
        location = tool_parameters.get("location")

        api_key = self.runtime.credentials['searchapi_api_key']
        result = SearchAPI(api_key).run(query, result_type=result_type, num=num, google_domain=google_domain, gl=gl, hl=hl, location=location)

        if result_type == 'text':
            return self.create_text_message(text=result)
        return self.create_link_message(link=result)
