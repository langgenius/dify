from pydantic import BaseModel


class RerankDocument(BaseModel):
    """
    Model class for rerank document.
    """

    index: int
    text: str
    score: float


class RerankResult(BaseModel):
    """
    Model class for rerank result.
    """

    model: str
    docs: list[RerankDocument]
