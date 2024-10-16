from enum import Enum


class EmbeddingInputType(Enum):
    """
    Enum for embedding input type.
    """

    DOCUMENT = "document"
    QUERY = "query"
