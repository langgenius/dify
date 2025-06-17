from typing import Optional

from pydantic import Field
from pydantic_settings import BaseSettings


class LindormConfig(BaseSettings):
    """
    Lindorm configs
    """

    LINDORM_URL: Optional[str] = Field(
        description="Lindorm url",
        default=None,
    )
    LINDORM_USERNAME: Optional[str] = Field(
        description="Lindorm user",
        default=None,
    )
    LINDORM_PASSWORD: Optional[str] = Field(
        description="Lindorm password",
        default=None,
    )
    DEFAULT_INDEX_TYPE: Optional[str] = Field(
        description="Lindorm Vector Index Type, hnsw or flat is available in dify",
        default="hnsw",
    )
    DEFAULT_DISTANCE_TYPE: Optional[str] = Field(
        description="Vector Distance Type, support l2, cosinesimil, innerproduct", default="l2"
    )
    USING_UGC_INDEX: Optional[bool] = Field(
        description="Using UGC index will store the same type of Index in a single index but can retrieve separately.",
        default=False,
    )
    LINDORM_QUERY_TIMEOUT: Optional[float] = Field(description="The lindorm search request timeout (s)", default=2.0)
