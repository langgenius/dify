from typing import Literal

from pydantic import Field
from pydantic_settings import BaseSettings


class S3StorageConfig(BaseSettings):
    """
    Configuration settings for S3-compatible object storage
    """

    S3_ENDPOINT: str | None = Field(
        description="URL of the S3-compatible storage endpoint (e.g., 'https://s3.amazonaws.com')",
        default=None,
    )

    S3_REGION: str | None = Field(
        description="Region where the S3 bucket is located (e.g., 'us-east-1')",
        default=None,
    )

    S3_BUCKET_NAME: str | None = Field(
        description="Name of the S3 bucket to store and retrieve objects",
        default=None,
    )

    S3_ACCESS_KEY: str | None = Field(
        description="Access key ID for authenticating with the S3 service",
        default=None,
    )

    S3_SECRET_KEY: str | None = Field(
        description="Secret access key for authenticating with the S3 service",
        default=None,
    )

    S3_ADDRESS_STYLE: Literal["auto", "virtual", "path"] = Field(
        description="S3 addressing style: 'auto', 'path', or 'virtual'",
        default="auto",
    )

    S3_USE_AWS_MANAGED_IAM: bool = Field(
        description="Use AWS managed IAM roles for authentication instead of access/secret keys",
        default=False,
    )

    S3_PUBLIC_BASE_URL: str | None = Field(
        description=(
            "Optional public base URL for objects in the bucket "
            "(e.g., a Cloudflare R2 custom domain, MinIO public endpoint, or "
            "OSS public domain). When set, signed file previews are served via "
            "302 redirect to '<base>/<object-key>' so that bytes are delivered "
            "directly by the object store / CDN instead of proxied by Dify's API. "
            "Trailing slashes are ignored. Leave empty to keep the default "
            "API-streamed behavior."
        ),
        default=None,
    )
