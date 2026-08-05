from typing import Literal

from pydantic import Field, PositiveInt
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
    PUBLIC_STORAGE_ICON_S3_BUCKET: str | None = Field(
        default=None,
        description="S3-compatible bucket for icon uploads. Falls back to S3_BUCKET_NAME.",
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
    PUBLIC_STORAGE_ICON_S3_DOWNLOAD_MODE: Literal["proxy", "presigned", "cf_waf_hmac"] = Field(
        default="proxy",
        description="Download URL strategy for icons stored in public S3-compatible storage.",
    )
    PUBLIC_STORAGE_ICON_S3_DOWNLOAD_URL_EXPIRES_IN: PositiveInt = Field(
        default=300,
        description="Lifetime for icon presigned URLs and the expected Cloudflare WAF validation window.",
    )
    PUBLIC_STORAGE_ICON_S3_CF_WAF_HMAC_BASE_URL: str | None = Field(
        default=None,
        description="Public icon base URL protected by Cloudflare WAF HMAC validation.",
    )
    PUBLIC_STORAGE_ICON_S3_CF_WAF_HMAC_SECRET: str | None = Field(
        default=None,
        description="Secret used to sign Cloudflare WAF HMAC icon URLs.",
    )
