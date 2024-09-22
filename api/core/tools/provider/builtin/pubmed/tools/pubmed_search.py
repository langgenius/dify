import json
import time
import urllib.error
import urllib.parse
import urllib.request
from typing import Any

from pydantic import BaseModel, Field

from core.tools.entities.tool_entities import ToolInvokeMessage
from core.tools.tool.builtin_tool import BuiltinTool


class PubMedAPIWrapper(BaseModel):
    """
    Wrapper around PubMed API.

    This wrapper will use the PubMed API to conduct searches and fetch
    document summaries. By default, it will return the document summaries
    of the top-k results of an input search.

    Parameters:
        top_k_results: number of the top-scored document used for the PubMed tool
        load_max_docs: a limit to the number of loaded documents
        load_all_available_meta:
          if True: the `metadata` of the loaded Documents gets all available meta info
            (see https://www.ncbi.nlm.nih.gov/books/NBK25499/#chapter4.ESearch)
          if False: the `metadata` gets only the most informative fields.
    """

    base_url_esearch: str = "https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi?"
    base_url_efetch: str = "https://eutils.ncbi.nlm.nih.gov/entrez/eutils/efetch.fcgi?"
    max_retry: int = 5
    sleep_time: float = 0.2

    # Default values for the parameters
    top_k_results: int = 3
    load_max_docs: int = 25
    ARXIV_MAX_QUERY_LENGTH: int = 300
    doc_content_chars_max: int = 2000
    load_all_available_meta: bool = False
    email: str = "your_email@example.com"

    def run(self, query: str) -> str:
        """
        Run PubMed search and get the article meta information.
        See https://www.ncbi.nlm.nih.gov/books/NBK25499/#chapter4.ESearch
        It uses only the most informative fields of article meta information.
        """

        try:
            # Retrieve the top-k results for the query
            docs = [
                f"Published: {result['pub_date']}\nTitle: {result['title']}\nSummary: {result['summary']}"
                for result in self.load(query[: self.ARXIV_MAX_QUERY_LENGTH])
            ]

            # Join the results and limit the character count
            return "\n\n".join(docs)[: self.doc_content_chars_max] if docs else "No good PubMed Result was found"
        except Exception as ex:
            return f"PubMed exception: {ex}"

    def load(self, query: str) -> list[dict]:
        """
        Search PubMed for documents matching the query.
        Return a list of dictionaries containing the document metadata.
        """

        url = (
            self.base_url_esearch
            + "db=pubmed&term="
            + str({urllib.parse.quote(query)})
            + f"&retmode=json&retmax={self.top_k_results}&usehistory=y"
        )
        result = urllib.request.urlopen(url)
        text = result.read().decode("utf-8")
        json_text = json.loads(text)

        articles = []
        webenv = json_text["esearchresult"]["webenv"]
        for uid in json_text["esearchresult"]["idlist"]:
            article = self.retrieve_article(uid, webenv)
            articles.append(article)

        # Convert the list of articles to a JSON string
        return articles

    def retrieve_article(self, uid: str, webenv: str) -> dict:
        url = self.base_url_efetch + "db=pubmed&retmode=xml&id=" + uid + "&webenv=" + webenv

        retry = 0
        while True:
            try:
                result = urllib.request.urlopen(url)
                break
            except urllib.error.HTTPError as e:
                if e.code == 429 and retry < self.max_retry:
                    # Too Many Requests error
                    # wait for an exponentially increasing amount of time
                    print(f"Too Many Requests, waiting for {self.sleep_time:.2f} seconds...")
                    time.sleep(self.sleep_time)
                    self.sleep_time *= 2
                    retry += 1
                else:
                    raise e

        xml_text = result.read().decode("utf-8")

        # Get title
        title = ""
        if "<ArticleTitle>" in xml_text and "</ArticleTitle>" in xml_text:
            start_tag = "<ArticleTitle>"
            end_tag = "</ArticleTitle>"
            title = xml_text[xml_text.index(start_tag) + len(start_tag) : xml_text.index(end_tag)]

        # Get abstract
        abstract = ""
        if "<AbstractText>" in xml_text and "</AbstractText>" in xml_text:
            start_tag = "<AbstractText>"
            end_tag = "</AbstractText>"
            abstract = xml_text[xml_text.index(start_tag) + len(start_tag) : xml_text.index(end_tag)]

        # Get publication date
        pub_date = ""
        if "<PubDate>" in xml_text and "</PubDate>" in xml_text:
            start_tag = "<PubDate>"
            end_tag = "</PubDate>"
            pub_date = xml_text[xml_text.index(start_tag) + len(start_tag) : xml_text.index(end_tag)]

        # Return article as dictionary
        article = {
            "uid": uid,
            "title": title,
            "summary": abstract,
            "pub_date": pub_date,
        }
        return article


class PubmedQueryRun(BaseModel):
    """Tool that searches the PubMed API."""

    name: str = "PubMed"
    description: str = (
        "A wrapper around PubMed.org "
        "Useful for when you need to answer questions about Physics, Mathematics, "
        "Computer Science, Quantitative Biology, Quantitative Finance, Statistics, "
        "Electrical Engineering, and Economics "
        "from scientific articles on PubMed.org. "
        "Input should be a search query."
    )
    api_wrapper: PubMedAPIWrapper = Field(default_factory=PubMedAPIWrapper)

    def _run(
        self,
        query: str,
    ) -> str:
        """Use the Arxiv tool."""
        return self.api_wrapper.run(query)


class PubMedInput(BaseModel):
    query: str = Field(..., description="Search query.")


class PubMedSearchTool(BuiltinTool):
    """
    Tool for performing a search using PubMed search engine.
    """

    def _invoke(self, user_id: str, tool_parameters: dict[str, Any]) -> ToolInvokeMessage | list[ToolInvokeMessage]:
        """
        Invoke the PubMed search tool.

        Args:
            user_id (str): The ID of the user invoking the tool.
            tool_parameters (dict[str, Any]): The parameters for the tool invocation.

        Returns:
            ToolInvokeMessage | list[ToolInvokeMessage]: The result of the tool invocation.
        """
        query = tool_parameters.get("query", "")

        if not query:
            return self.create_text_message("Please input query")

        tool = PubmedQueryRun(args_schema=PubMedInput)

        result = tool._run(query)

        return self.create_text_message(self.summary(user_id=user_id, content=result))
