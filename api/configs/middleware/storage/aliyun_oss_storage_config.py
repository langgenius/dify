from typing import Optional

from pydantic import BaseModel, Field


class AliyunOSSStorageConfig(BaseModel):
    """
    Aliyun storage configs
    """

    ALIYUN_OSS_BUCKET_NAME: Optional[str] = Field(
        description='Aliyun storage ',
        default=None,
    )

    ALIYUN_OSS_ACCESS_KEY: Optional[str] = Field(
        description='Aliyun storage access key',
        default=None,
    )

    ALIYUN_OSS_SECRET_KEY: Optional[str] = Field(
        description='Aliyun storage secret key',
        default=None,
    )

    ALIYUN_OSS_ENDPOINT: Optional[str] = Field(
        description='Aliyun storage endpoint URL',
        default=None,
    )

    ALIYUN_OSS_REGION: Optional[str] = Field(
        description='Aliyun storage region',
        default=None,
    )

    ALIYUN_OSS_AUTH_VERSION: Optional[str] = Field(
        description='Aliyun storage authentication version',
        default=None,
    )
