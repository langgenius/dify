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
    LINDORM_INDEX_TYPE: Optional[str] = Field(
        description="Lindorm Vector Index Type, hnsw or flat is available in dify",
        default="hnsw",
    )
    LINDORM_DISTANCE_TYPE: Optional[str] = Field(
        description="Vector Distance Type, support l2, cosinesimil, innerproduct", default="l2"
    )
    LINDORM_USING_UGC: Optional[bool] = Field(
        description="Using UGC index will store indexes with the same IndexType/Dimension in a single big index.",
        default=True,
    )
    LINDORM_QUERY_TIMEOUT: Optional[float] = Field(description="The lindorm search request timeout (s)", default=2.0)
