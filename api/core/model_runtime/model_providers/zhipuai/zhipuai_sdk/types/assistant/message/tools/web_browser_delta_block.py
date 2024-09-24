from typing import Literal

from .....core import BaseModel

__all__ = ["WebBrowserToolBlock"]


class WebBrowserOutput(BaseModel):
    """
    This class represents the output of a web browser search result.

    Attributes:
    - title (str): The title of the search result.
    - link (str): The URL link to the search result's webpage.
    - content (str): The textual content extracted from the search result.
    - error_msg (str): Any error message encountered during the search or retrieval process.
    """

    title: str
    link: str
    content: str
    error_msg: str


class WebBrowser(BaseModel):
    """
    This class represents the input and outputs of a web browser search.

    Attributes:
    - input (str): The input query for the web browser search.
    - outputs (List[WebBrowserOutput]): A list of search results returned by the web browser.
    """

    input: str
    outputs: list[WebBrowserOutput]


class WebBrowserToolBlock(BaseModel):
    """
    This class represents a block for invoking the web browser tool.

    Attributes:
    - web_browser (WebBrowser): An instance of the WebBrowser class containing the search input and outputs.
    - type (Literal["web_browser"]): The type of tool being used, always set to "web_browser".
    """

    web_browser: WebBrowser
    type: Literal["web_browser"]
