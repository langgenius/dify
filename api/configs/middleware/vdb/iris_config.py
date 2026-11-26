"""Configuration for InterSystems IRIS vector database."""

from typing import Self

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

    @model_validator(mode="after")
    def validate_config(self) -> Self:
        """Validate pool ordering after settings have been parsed as positive integers.

        Environment strings and omitted defaults are resolved by field
        validation first. Return these settings unchanged when the minimum
        does not exceed the maximum; otherwise raise ``ValueError``.
        """
        if self.IRIS_MIN_CONNECTION > self.IRIS_MAX_CONNECTION:
            raise ValueError("IRIS_MIN_CONNECTION must be less than or equal to IRIS_MAX_CONNECTION")

        return self
