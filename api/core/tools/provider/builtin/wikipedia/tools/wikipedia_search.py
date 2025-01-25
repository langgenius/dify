from typing import Any, Optional, Union

import wikipedia  # type: ignore

from core.tools.entities.tool_entities import ToolInvokeMessage
from core.tools.tool.builtin_tool import BuiltinTool

WIKIPEDIA_MAX_QUERY_LENGTH = 300


class WikipediaAPIWrapper:
    """Wrapper around WikipediaAPI.

    To use, you should have the ``wikipedia`` python package installed.
    This wrapper will use the Wikipedia API to conduct searches and
    fetch page summaries. By default, it will return the page summaries
    of the top-k results.
    It limits the Document content by doc_content_chars_max.
    """

    top_k_results: int = 3
    lang: str = "en"
    load_all_available_meta: bool = False
    doc_content_chars_max: int = 4000

    def __init__(self, doc_content_chars_max: int = 4000):
        self.doc_content_chars_max = doc_content_chars_max

    def run(self, query: str, lang: str = "") -> str:
        if lang in wikipedia.languages():
            self.lang = lang

        wikipedia.set_lang(self.lang)
        wiki_client = wikipedia

        """Run Wikipedia search and get page summaries."""
        page_titles = wiki_client.search(query[:WIKIPEDIA_MAX_QUERY_LENGTH])
        summaries = []
        for page_title in page_titles[: self.top_k_results]:
            if wiki_page := self._fetch_page(page_title):
                if summary := self._formatted_page_summary(page_title, wiki_page):
                    summaries.append(summary)
        if not summaries:
            return "No good Wikipedia Search Result was found"
        return "\n\n".join(summaries)[: self.doc_content_chars_max]

    @staticmethod
    def _formatted_page_summary(page_title: str, wiki_page: Any) -> Optional[str]:
        return f"Page: {page_title}\nSummary: {wiki_page.summary}"

    def _fetch_page(self, page: str) -> Optional[str]:
        try:
            return wikipedia.page(title=page, auto_suggest=False)
        except (
            wikipedia.exceptions.PageError,
            wikipedia.exceptions.DisambiguationError,
        ):
            return None


class WikipediaQueryRun:
    """Tool that searches the Wikipedia API."""

    name = "Wikipedia"
    description = (
        "A wrapper around Wikipedia. "
        "Useful for when you need to answer general questions about "
        "people, places, companies, facts, historical events, or other subjects. "
        "Input should be a search query."
    )
    api_wrapper: WikipediaAPIWrapper

    def __init__(self, api_wrapper: WikipediaAPIWrapper):
        self.api_wrapper = api_wrapper

    def _run(
        self,
        query: str,
        lang: str = "",
    ) -> str:
        """Use the Wikipedia tool."""
        return self.api_wrapper.run(query, lang)


class WikiPediaSearchTool(BuiltinTool):
    def _invoke(
        self,
        user_id: str,
        tool_parameters: dict[str, Any],
    ) -> Union[ToolInvokeMessage, list[ToolInvokeMessage]]:
        """
        invoke tools
        """
        query = tool_parameters.get("query", "")
        lang = tool_parameters.get("language", "")
        if not query:
            return self.create_text_message("Please input query")

        tool = WikipediaQueryRun(
            api_wrapper=WikipediaAPIWrapper(doc_content_chars_max=4000),
        )

        result = tool._run(query, lang)

        return self.create_text_message(self.summary(user_id=user_id, content=result))
