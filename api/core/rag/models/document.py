from typing import Optional

from pydantic import Field, BaseModel


class Document(BaseModel):
    """Class for storing a piece of text and associated metadata."""

    page_content: str

    """Arbitrary metadata about the page content (e.g., source, relationships to other
        documents, etc.).
    """
    metadata: Optional[dict] = Field(default_factory=dict)


