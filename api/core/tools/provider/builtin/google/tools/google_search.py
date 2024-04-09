import os
import sys
from typing import Any, Union

from serpapi import GoogleSearch

from core.tools.entities.tool_entities import ToolInvokeMessage
from core.tools.tool.builtin_tool import BuiltinTool


class HiddenPrints:
    """Context manager to hide prints."""

    def __enter__(self) -> None:
        """Open file to pipe stdout to."""
        self._original_stdout = sys.stdout
        sys.stdout = open(os.devnull, "w")

    def __exit__(self, *_: Any) -> None:
        """Close file that stdout was piped to."""
        sys.stdout.close()
        sys.stdout = self._original_stdout


class SerpAPI:
    """
    SerpAPI tool provider.
    """

    search_engine: Any  #: :meta private:
    serpapi_api_key: str = None

    def __init__(self, api_key: str) -> None:
        """Initialize SerpAPI tool provider."""
        self.serpapi_api_key = api_key
        self.search_engine = GoogleSearch

    def run(self, query: str, **kwargs: Any) -> str:
        """Run query through SerpAPI and parse result."""
        typ = kwargs.get("result_type", "text")
        return self._process_response(self.results(query), typ=typ)

    def results(self, query: str) -> dict:
        """Run query through SerpAPI and return the raw result."""
        params = self.get_params(query)
        with HiddenPrints():
            search = self.search_engine(params)
            res = search.get_dict()
        return res

    def get_params(self, query: str) -> dict[str, str]:
        """Get parameters for SerpAPI."""
        _params = {
            "api_key": self.serpapi_api_key,
            "q": query,
        }
        params = {
            "engine": "google",
            "google_domain": "google.com",
            "gl": "us",
            "hl": "en",
            **_params
        }
        return params

    @staticmethod
    def _process_response(res: dict, typ: str) -> str:
        """Process response from SerpAPI."""
        if "error" in res.keys():
            raise ValueError(f"Got error from SerpAPI: {res['error']}")
        
        if typ == "text":
            toret = ""
            if "answer_box" in res.keys() and type(res["answer_box"]) == list:
                res["answer_box"] = res["answer_box"][0] + "\n"
            if "answer_box" in res.keys() and "answer" in res["answer_box"].keys():
                toret += res["answer_box"]["answer"] + "\n"
            if "answer_box" in res.keys() and "snippet" in res["answer_box"].keys():
                toret += res["answer_box"]["snippet"] + "\n"
            if (
                "answer_box" in res.keys()
                and "snippet_highlighted_words" in res["answer_box"].keys()
            ):
                for item in res["answer_box"]["snippet_highlighted_words"]:
                    toret += item + "\n"
            if (
                "sports_results" in res.keys()
                and "game_spotlight" in res["sports_results"].keys()
            ):
                toret += res["sports_results"]["game_spotlight"] + "\n"
            if (
                "shopping_results" in res.keys()
                and "title" in res["shopping_results"][0].keys()
            ):
                toret += res["shopping_results"][:3] + "\n"
            if (
                "knowledge_graph" in res.keys()
                and "description" in res["knowledge_graph"].keys()
            ):
                toret = res["knowledge_graph"]["description"] + "\n"
            if "snippet" in res["organic_results"][0].keys():
                for item in res["organic_results"]:
                    toret += "content: " + item["snippet"] + "\n" + "link: " + item["link"] + "\n"
            if (
                "images_results" in res.keys()
                and "thumbnail" in res["images_results"][0].keys()
            ):
                thumbnails = [item["thumbnail"] for item in res["images_results"][:10]]
                toret = thumbnails
            if toret == "":
                toret = "No good search result found"
        elif typ == "link":
            if "knowledge_graph" in res.keys() and "title" in res["knowledge_graph"].keys() \
                    and "description_link" in res["knowledge_graph"].keys():
                toret = res["knowledge_graph"]["description_link"]
            elif "knowledge_graph" in res.keys() and "see_results_about" in res["knowledge_graph"].keys() \
                and len(res["knowledge_graph"]["see_results_about"]) > 0:
                see_result_about = res["knowledge_graph"]["see_results_about"]
                toret = ""
                for item in see_result_about:
                    if "name" not in item.keys() or "link" not in item.keys():
                        continue
                    toret += f"[{item['name']}]({item['link']})\n"
            elif "organic_results" in res.keys() and len(res["organic_results"]) > 0:
                organic_results = res["organic_results"]
                toret = ""
                for item in organic_results:
                    if "title" not in item.keys() or "link" not in item.keys():
                        continue
                    toret += f"[{item['title']}]({item['link']})\n"
            elif "related_questions" in res.keys() and len(res["related_questions"]) > 0:
                related_questions = res["related_questions"]
                toret = ""
                for item in related_questions:
                    if "question" not in item.keys() or "link" not in item.keys():
                        continue
                    toret += f"[{item['question']}]({item['link']})\n"
            elif "related_searches" in res.keys() and len(res["related_searches"]) > 0:
                related_searches = res["related_searches"]
                toret = ""
                for item in related_searches:
                    if "query" not in item.keys() or "link" not in item.keys():
                        continue
                    toret += f"[{item['query']}]({item['link']})\n"
            else:
                toret = "No good search result found"
        return toret

class GoogleSearchTool(BuiltinTool):
    def _invoke(self, 
                user_id: str,
               tool_parameters: dict[str, Any], 
        ) -> Union[ToolInvokeMessage, list[ToolInvokeMessage]]:
        """
            invoke tools
        """
        query = tool_parameters['query']
        result_type = tool_parameters['result_type']
        api_key = self.runtime.credentials['serpapi_api_key']
        result = SerpAPI(api_key).run(query, result_type=result_type)
        if result_type == 'text':
            return self.create_text_message(text=result)
        return self.create_link_message(link=result)
    