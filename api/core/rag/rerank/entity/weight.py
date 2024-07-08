from pydantic import BaseModel


class Weights(BaseModel):
    """Model for weighted rerank."""
    weight_type: str

    vector_weight: float

    keyword_weight: float
