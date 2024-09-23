from typing import Optional

from pydantic import Field
from pydantic_settings import BaseSettings


class S3StorageConfig(BaseSettings):
    """
    Configuration settings for S3-compatible object storage
    """

    S3_ENDPOINT: Optional[str] = Field(
        description="URL of the S3-compatible storage endpoint (e.g., 'https://s3.amazonaws.com')",
        default=None,
    )

    S3_REGION: Optional[str] = Field(
        description="Region where the S3 bucket is located (e.g., 'us-east-1')",
        default=None,
    )

    S3_BUCKET_NAME: Optional[str] = Field(
        description="Name of the S3 bucket to store and retrieve objects",
        default=None,
    )

    S3_ACCESS_KEY: Optional[str] = Field(
        description="Access key ID for authenticating with the S3 service",
        default=None,
    )

    S3_SECRET_KEY: Optional[str] = Field(
        description="Secret access key for authenticating with the S3 service",
        default=None,
    )

    S3_ADDRESS_STYLE: str = Field(
        description="S3 addressing style: 'auto', 'path', or 'virtual'",
        default="auto",
    )

    S3_USE_AWS_MANAGED_IAM: bool = Field(
        description="Use AWS managed IAM roles for authentication instead of access/secret keys",
        default=False,
    )
