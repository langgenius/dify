"""Abstract interface for document loader implementations."""

import re
from typing import override

from bs4 import BeautifulSoup, NavigableString, Tag

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

        text = _flatten(soup)
        return re.sub(r"\n{3,}", "\n\n", text).strip() if text else ""


_END_OF_CHILDREN = object()


def _flatten(soup: BeautifulSoup) -> str:
    """The text of ``soup``, with a line break at each ``<br>`` and after each block.

    A separator argument to get_text() would also land between inline elements,
    turning "Hello <b>world</b>!" into "Hello world !", so only the end of each
    block gets one. The tree is walked once instead of rewritten: replacing each
    ``<br>`` in place scans its siblings every time, which is quadratic on a
    page with thousands of them.
    """
    # The strings get_text() joins: script, style and template text stays out
    # exactly as it does there.
    wanted = {id(string) for string in soup.strings}
    parts: list[str] = []
    children = [iter(soup.contents)]
    open_tags: list[str | None] = [None]
    while children:
        node = next(children[-1], _END_OF_CHILDREN)
        if node is _END_OF_CHILDREN:
            children.pop()
            if open_tags.pop() in _BLOCK_LEVEL_TAGS:
                parts.append("\n")
        elif isinstance(node, NavigableString):
            if id(node) in wanted:
                parts.append(node)
        elif isinstance(node, Tag):
            if node.name == "br":
                parts.append("\n")
            else:
                children.append(iter(node.contents))
                open_tags.append(node.name)
    return "".join(parts)
