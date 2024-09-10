from typing import Optional

from pydantic import Field, PositiveInt
from pydantic_settings import BaseSettings


class TiDBVectorConfig(BaseSettings):
    """
    TiDB Vector configs
    """

    TIDB_VECTOR_HOST: Optional[str] = Field(
        description="TiDB Vector host",
        default=None,
    )

    TIDB_VECTOR_PORT: Optional[PositiveInt] = Field(
        description="TiDB Vector port",
        default=4000,
    )

    TIDB_VECTOR_USER: Optional[str] = Field(
        description="TiDB Vector user",
        default=None,
    )

    TIDB_VECTOR_PASSWORD: Optional[str] = Field(
        description="TiDB Vector password",
        default=None,
    )

    TIDB_VECTOR_DATABASE: Optional[str] = Field(
        description="TiDB Vector database",
        default=None,
    )
