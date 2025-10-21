from pydantic import Field
from pydantic_settings import BaseSettings


class LindormConfig(BaseSettings):
    """
    Lindorm configs
    """

    LINDORM_URL: str | None = Field(
        description="Lindorm url",
        default=None,
    )
    LINDORM_USERNAME: str | None = Field(
        description="Lindorm user",
        default=None,
    )
    LINDORM_PASSWORD: str | None = Field(
        description="Lindorm password",
        default=None,
    )
    LINDORM_INDEX_TYPE: str | None = Field(
        description="Lindorm Vector Index Type, hnsw or flat is available in dify",
        default="hnsw",
    )
    LINDORM_DISTANCE_TYPE: str | None = Field(
        description="Vector Distance Type, support l2, cosinesimil, innerproduct", default="l2"
    )
    LINDORM_USING_UGC: bool | None = Field(
        description="Using UGC index will store indexes with the same IndexType/Dimension in a single big index.",
        default=True,
    )
    LINDORM_QUERY_TIMEOUT: float | None = Field(description="The lindorm search request timeout (s)", default=2.0)
