from typing import Optional

from pydantic import Field, PositiveInt
from pydantic_settings import BaseSettings


class PGVectorConfig(BaseSettings):
    """
    PGVector configs
    """

    PGVECTOR_HOST: Optional[str] = Field(
        description="PGVector host",
        default=None,
    )

    PGVECTOR_PORT: Optional[PositiveInt] = Field(
        description="PGVector port",
        default=5433,
    )

    PGVECTOR_USER: Optional[str] = Field(
        description="PGVector user",
        default=None,
    )

    PGVECTOR_PASSWORD: Optional[str] = Field(
        description="PGVector password",
        default=None,
    )

    PGVECTOR_DATABASE: Optional[str] = Field(
        description="PGVector database",
        default=None,
    )
