from pydantic import Field


class Document:
    """Class for storing a piece of text and associated metadata."""

    page_content: str

    """Arbitrary metadata about the page content (e.g., source, relationships to other
        documents, etc.).
    """
    metadata: dict = Field(default_factory=dict)

    def __init__(self, page_content:  str, metadata: dict = None):
        self.page_content = page_content
        self.metadata = metadata

