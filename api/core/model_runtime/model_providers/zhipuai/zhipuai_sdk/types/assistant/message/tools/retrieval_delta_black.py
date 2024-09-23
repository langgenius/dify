from typing import Literal

from .....core import BaseModel


class RetrievalToolOutput(BaseModel):
    """
    This class represents the output of a retrieval tool.

    Attributes:
    - text (str): The text snippet retrieved from the knowledge base.
    - document (str): The name of the document from which the text snippet was retrieved, returned only in intelligent configuration.
    """  # noqa: E501

    text: str
    document: str


class RetrievalTool(BaseModel):
    """
    This class represents the outputs of a retrieval tool.

    Attributes:
    - outputs (List[RetrievalToolOutput]): A list of text snippets and their respective document names retrieved from the knowledge base.
    """  # noqa: E501

    outputs: list[RetrievalToolOutput]


class RetrievalToolBlock(BaseModel):
    """
    This class represents a block for invoking the retrieval tool.

    Attributes:
    - retrieval (RetrievalTool): An instance of the RetrievalTool class containing the retrieval outputs.
    - type (Literal["retrieval"]): The type of tool being used, always set to "retrieval".
    """

    retrieval: RetrievalTool
    type: Literal["retrieval"]
    """Always `retrieval`."""
