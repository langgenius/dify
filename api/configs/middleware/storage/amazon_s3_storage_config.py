from typing import Optional

from pydantic import BaseModel, Field


class S3StorageConfig(BaseModel):
    """
    S3 storage configs
    """

    S3_ENDPOINT: Optional[str] = Field(
        description='S3 storage endpoint',
        default=None,
    )

    S3_REGION: Optional[str] = Field(
        description='S3 storage region',
        default=None,
    )

    S3_BUCKET_NAME: Optional[str] = Field(
        description='S3 storage bucket name',
        default=None,
    )

    S3_ACCESS_KEY: Optional[str] = Field(
        description='S3 storage access key',
        default=None,
    )

    S3_SECRET_KEY: Optional[str] = Field(
        description='S3 storage secret key',
        default=None,
    )

    S3_ADDRESS_STYLE: str = Field(
        description='S3 storage address style',
        default='auto',
    )

    S3_USE_AWS_MANAGED_IAM: bool = Field(
        description='whether to use aws managed IAM for S3',
        default=False,
    )
