from core.tools.provider.tool_provider import Tool
from core.tools.entities.tool_entities import AssistantAppMessage
from core.model_runtime.entities.message_entities import PromptMessage

from typing import Any, Dict, List, Union, Optional, Tuple

import os
import sys

from serpapi import GoogleSearch

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
        return self._process_response(self.results(query))

    def results(self, query: str) -> dict:
        """Run query through SerpAPI and return the raw result."""
        params = self.get_params(query)
        with HiddenPrints():
            search = self.search_engine(params)
            res = search.get_dict()
        return res

    def get_params(self, query: str) -> Dict[str, str]:
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
    def _process_response(res: dict) -> str:
        """Process response from SerpAPI."""
        if "error" in res.keys():
            raise ValueError(f"Got error from SerpAPI: {res['error']}")
        if "answer_box" in res.keys() and type(res["answer_box"]) == list:
            res["answer_box"] = res["answer_box"][0]
        if "answer_box" in res.keys() and "answer" in res["answer_box"].keys():
            toret = res["answer_box"]["answer"]
        elif "answer_box" in res.keys() and "snippet" in res["answer_box"].keys():
            toret = res["answer_box"]["snippet"]
        elif (
            "answer_box" in res.keys()
            and "snippet_highlighted_words" in res["answer_box"].keys()
        ):
            toret = res["answer_box"]["snippet_highlighted_words"][0]
        elif (
            "sports_results" in res.keys()
            and "game_spotlight" in res["sports_results"].keys()
        ):
            toret = res["sports_results"]["game_spotlight"]
        elif (
            "shopping_results" in res.keys()
            and "title" in res["shopping_results"][0].keys()
        ):
            toret = res["shopping_results"][:3]
        elif (
            "knowledge_graph" in res.keys()
            and "description" in res["knowledge_graph"].keys()
        ):
            toret = res["knowledge_graph"]["description"]
        elif "snippet" in res["organic_results"][0].keys():
            toret = res["organic_results"][0]["snippet"]
        elif "link" in res["organic_results"][0].keys():
            toret = res["organic_results"][0]["link"]
        elif (
            "images_results" in res.keys()
            and "thumbnail" in res["images_results"][0].keys()
        ):
            thumbnails = [item["thumbnail"] for item in res["images_results"][:10]]
            toret = thumbnails
        else:
            toret = "No good search result found"
        return toret


class GoogleSearchTool(Tool):
    def _invoke(self, 
               tool_paramters: Dict[str, Any], 
               credentials: Dict[str, Any], 
               prompt_messages: List[PromptMessage]
        ) -> Union[AssistantAppMessage, List[AssistantAppMessage]]:
        """
            invoke tools
        """
        query = tool_paramters['query']
        result_type = tool_paramters['result_type']
        api_key = credentials['serpapi_api_key']
        result = SerpAPI(api_key).run(query)
        if result_type == 'text':
            return self.create_text_message(text=result)
        return self.create_link_message(link='https://www.google.com')
    
    def validate_credentials(self, credentails: Dict[str, Any], parameters: Dict[str, Any]) -> None:
        self._invoke(parameters, credentails, [])