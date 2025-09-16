from pydantic import Field, PositiveInt
from pydantic_settings import BaseSettings


class TiDBVectorConfig(BaseSettings):
    """
    Configuration settings for TiDB Vector database
    """

    TIDB_VECTOR_HOST: str | None = Field(
        description="Hostname or IP address of the TiDB Vector server (e.g., 'localhost' or 'tidb.example.com')",
        default=None,
    )

    TIDB_VECTOR_PORT: PositiveInt | None = Field(
        description="Port number on which the TiDB Vector server is listening (default is 4000)",
        default=4000,
    )

    TIDB_VECTOR_USER: str | None = Field(
        description="Username for authenticating with the TiDB Vector database",
        default=None,
    )

    TIDB_VECTOR_PASSWORD: str | None = Field(
        description="Password for authenticating with the TiDB Vector database",
        default=None,
    )

    TIDB_VECTOR_DATABASE: str | None = Field(
        description="Name of the TiDB Vector database to connect to",
        default=None,
    )
