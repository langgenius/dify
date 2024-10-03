from pydantic import BaseModel


class DocumentContext(BaseModel):
    """
    Model class for document context.
    """

    content: str
    score: float
