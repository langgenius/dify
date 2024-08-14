from typing import Optional

from pydantic import Field
from pydantic_settings import BaseSettings


class AliyunOSSStorageConfig(BaseSettings):
    """
    Aliyun storage configs
    """

    ALIYUN_OSS_BUCKET_NAME: Optional[str] = Field(
        description='Aliyun OSS bucket name',
        default=None,
    )

    ALIYUN_OSS_ACCESS_KEY: Optional[str] = Field(
        description='Aliyun OSS access key',
        default=None,
    )

    ALIYUN_OSS_SECRET_KEY: Optional[str] = Field(
        description='Aliyun OSS secret key',
        default=None,
    )

    ALIYUN_OSS_ENDPOINT: Optional[str] = Field(
        description='Aliyun OSS endpoint URL',
        default=None,
    )

    ALIYUN_OSS_REGION: Optional[str] = Field(
        description='Aliyun OSS region',
        default=None,
    )

    ALIYUN_OSS_AUTH_VERSION: Optional[str] = Field(
        description='Aliyun OSS authentication version',
        default=None,
    )
