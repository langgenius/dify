from typing import Optional

from pydantic import Field, PositiveInt
from pydantic_settings import BaseSettings


class PGVectorConfig(BaseSettings):
    """
    Configuration settings for PGVector (PostgreSQL with vector extension)
    """

    PGVECTOR_HOST: Optional[str] = Field(
        description="Hostname or IP address of the PostgreSQL server with PGVector extension (e.g., 'localhost')",
        default=None,
    )

    PGVECTOR_PORT: Optional[PositiveInt] = Field(
        description="Port number on which the PostgreSQL server is listening (default is 5433)",
        default=5433,
    )

    PGVECTOR_USER: Optional[str] = Field(
        description="Username for authenticating with the PostgreSQL database",
        default=None,
    )

    PGVECTOR_PASSWORD: Optional[str] = Field(
        description="Password for authenticating with the PostgreSQL database",
        default=None,
    )

    PGVECTOR_DATABASE: Optional[str] = Field(
        description="Name of the PostgreSQL database to connect to",
        default=None,
    )
