from typing import Literal

from pydantic import Field
from pydantic_settings import BaseSettings


class PublicStorageConfig(BaseSettings):
    """Configuration for optional public S3-compatible upload storage."""

    PUBLIC_STORAGE_ENABLED: bool = Field(
        default=False,
        description="Store public upload purposes in a dedicated S3-compatible bucket.",
    )
    PUBLIC_STORAGE_ENDPOINT: str | None = Field(
        default=None,
        description="S3-compatible endpoint for public uploads.",
    )
    PUBLIC_STORAGE_REGION: str = Field(
        default="auto",
        description="Region for public upload storage.",
    )
    PUBLIC_STORAGE_BUCKET_NAME: str | None = Field(
        default=None,
        description="Bucket for public uploads.",
    )
    PUBLIC_STORAGE_ACCESS_KEY: str | None = Field(
        default=None,
        description="Access key for public upload storage.",
    )
    PUBLIC_STORAGE_SECRET_KEY: str | None = Field(
        default=None,
        description="Secret key for public upload storage.",
    )
    PUBLIC_STORAGE_ADDRESS_STYLE: Literal["auto", "virtual", "path"] = Field(
        default="path",
        description="S3 addressing style for public upload storage.",
    )
