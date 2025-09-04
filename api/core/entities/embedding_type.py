from enum import StrEnum


class EmbeddingInputType(StrEnum):
    """
    Enum for embedding input type.
    """

    DOCUMENT = "document"
    QUERY = "query"
