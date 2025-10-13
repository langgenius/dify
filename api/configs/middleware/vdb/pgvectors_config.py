from pydantic import Field, PositiveInt
from pydantic_settings import BaseSettings


class PGVectoRSConfig(BaseSettings):
    """
    Configuration settings for PGVecto.RS (Rust-based vector extension for PostgreSQL)
    """

    PGVECTO_RS_HOST: str | None = Field(
        description="Hostname or IP address of the PostgreSQL server with PGVecto.RS extension (e.g., 'localhost')",
        default=None,
    )

    PGVECTO_RS_PORT: PositiveInt = Field(
        description="Port number on which the PostgreSQL server with PGVecto.RS is listening (default is 5431)",
        default=5431,
    )

    PGVECTO_RS_USER: str | None = Field(
        description="Username for authenticating with the PostgreSQL database using PGVecto.RS",
        default=None,
    )

    PGVECTO_RS_PASSWORD: str | None = Field(
        description="Password for authenticating with the PostgreSQL database using PGVecto.RS",
        default=None,
    )

    PGVECTO_RS_DATABASE: str | None = Field(
        description="Name of the PostgreSQL database with PGVecto.RS extension to connect to",
        default=None,
    )
