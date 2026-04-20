from typing import Literal

from pydantic import Field, NonNegativeInt, PositiveInt
from pydantic_settings import BaseSettings


class ValkeyConfig(BaseSettings):
    """Configuration settings for Valkey vector database (valkey-search module)."""

    VALKEY_HOST: str = Field(
        description="Hostname or IP address of the Valkey server.",
        default="localhost",
    )

    VALKEY_PORT: PositiveInt = Field(
        description="Port number for the Valkey server (default is 6379).",
        default=6379,
    )

    VALKEY_PASSWORD: str = Field(
        description="Password for authenticating with the Valkey server.",
        default="",
    )

    VALKEY_DB: NonNegativeInt = Field(
        description="Valkey database number to use (default is 0).",
        default=0,
    )

    VALKEY_USE_SSL: bool = Field(
        description="Whether to use SSL/TLS for the Valkey connection.",
        default=False,
    )

    VALKEY_DISTANCE_METRIC: Literal["COSINE", "L2", "IP"] = Field(
        description="Distance metric for vector similarity search. Options: COSINE, L2, IP.",
        default="COSINE",
    )
