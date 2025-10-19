from enum import StrEnum, auto


class EmbeddingInputType(StrEnum):
    """
    Enum for embedding input type.
    """

    DOCUMENT = auto()
    QUERY = auto()
