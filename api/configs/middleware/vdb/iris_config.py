"""Configuration for InterSystems IRIS vector database."""

from pydantic import Field, PositiveInt, model_validator
from pydantic_settings import BaseSettings


class IrisVectorConfig(BaseSettings):
    """Configuration settings for IRIS vector database connection and pooling."""

    IRIS_HOST: str | None = Field(
        description="Hostname or IP address of the IRIS server.",
        default="localhost",
    )

    IRIS_SUPER_SERVER_PORT: PositiveInt | None = Field(
        description="Port number for IRIS connection.",
        default=1972,
    )

    IRIS_USER: str | None = Field(
        description="Username for IRIS authentication.",
        default="_SYSTEM",
    )

    IRIS_PASSWORD: str | None = Field(
        description="Password for IRIS authentication.",
        default="Dify@1234",
    )

    IRIS_SCHEMA: str | None = Field(
        description="Schema name for IRIS tables.",
        default="dify",
    )

    IRIS_DATABASE: str | None = Field(
        description="Database namespace for IRIS connection.",
        default="USER",
    )

    IRIS_CONNECTION_URL: str | None = Field(
        description="Full connection URL for IRIS (overrides individual fields if provided).",
        default=None,
    )

    IRIS_MIN_CONNECTION: PositiveInt = Field(
        description="Minimum number of connections in the pool.",
        default=1,
    )

    IRIS_MAX_CONNECTION: PositiveInt = Field(
        description="Maximum number of connections in the pool.",
        default=3,
    )

    IRIS_TEXT_INDEX: bool = Field(
        description="Enable full-text search index using %iFind.Index.Basic.",
        default=True,
    )

    IRIS_TEXT_INDEX_LANGUAGE: str = Field(
        description="Language for full-text search index (e.g., 'en', 'ja', 'zh', 'de').",
        default="en",
    )

    @model_validator(mode="before")
    @classmethod
    def validate_config(cls, values: dict) -> dict:
        """Validate IRIS configuration values.

        Args:
            values: Configuration dictionary

        Returns:
            Validated configuration dictionary

        Raises:
            ValueError: If required fields are missing or pool settings are invalid
        """
        # Only validate required fields if IRIS is being used as the vector store
        # This allows the config to be loaded even when IRIS is not in use

        # vector_store = os.environ.get("VECTOR_STORE", "")
        # We rely on Pydantic defaults for required fields if they are missing from env.
        # Strict existence check is removed to allow defaults to work.

        min_conn = values.get("IRIS_MIN_CONNECTION", 1)
        max_conn = values.get("IRIS_MAX_CONNECTION", 3)
        if min_conn > max_conn:
            raise ValueError("IRIS_MIN_CONNECTION must be less than or equal to IRIS_MAX_CONNECTION")

        return values
