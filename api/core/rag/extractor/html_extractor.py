"""Abstract interface for document loader implementations."""

import re
from typing import override

from bs4 import BeautifulSoup

from core.rag.extractor.extractor_base import BaseExtractor
from core.rag.models.document import Document

# Elements a browser lays out on a line of their own, plus the few that are not
# laid out at all but still read as a line when a document is flattened
# (`title`, `option`). The markup is the only place that boundary exists, so
# without a break after them the text on either side runs together.
_BLOCK_LEVEL_TAGS = (
    "address",
    "article",
    "aside",
    "blockquote",
    "caption",
    "dd",
    "div",
    "dl",
    "dt",
    "details",
    "fieldset",
    "figcaption",
    "figure",
    "footer",
    "form",
    "h1",
    "h2",
    "h3",
    "h4",
    "h5",
    "h6",
    "header",
    "hgroup",
    "hr",
    "legend",
    "li",
    "main",
    "nav",
    "ol",
    "option",
    "p",
    "pre",
    "section",
    "summary",
    "table",
    "td",
    "th",
    "title",
    "tr",
    "ul",
)


class HtmlExtractor(BaseExtractor):
    """
    Load html files.


    Args:
        file_path: Path to the file to load.
    """

    def __init__(self, file_path: str):
        """Initialize with file path."""
        self._file_path = file_path

    @override
    def extract(self) -> list[Document]:
        return [Document(page_content=self._load_as_text())]

    def _load_as_text(self) -> str:
        with open(self._file_path, "rb") as fp:
            soup = BeautifulSoup(fp, "html.parser")

        for line_break in soup.find_all("br"):
            line_break.replace_with("\n")

        # A separator argument to get_text() would also land between inline
        # elements, turning "Hello <b>world</b>!" into "Hello world !", so the
        # end of each block is marked instead.
        for block in soup.find_all(_BLOCK_LEVEL_TAGS):
            block.append("\n")

        text: str = soup.get_text()
        return re.sub(r"\n{3,}", "\n\n", text).strip() if text else ""
