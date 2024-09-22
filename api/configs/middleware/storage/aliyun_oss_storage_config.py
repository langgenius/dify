from typing import Optional

from pydantic import Field
from pydantic_settings import BaseSettings


class AliyunOSSStorageConfig(BaseSettings):
    """
    Configuration settings for Aliyun Object Storage Service (OSS)
    """

    ALIYUN_OSS_BUCKET_NAME: Optional[str] = Field(
        description="Name of the Aliyun OSS bucket to store and retrieve objects",
        default=None,
    )

    ALIYUN_OSS_ACCESS_KEY: Optional[str] = Field(
        description="Access key ID for authenticating with Aliyun OSS",
        default=None,
    )

    ALIYUN_OSS_SECRET_KEY: Optional[str] = Field(
        description="Secret access key for authenticating with Aliyun OSS",
        default=None,
    )

    ALIYUN_OSS_ENDPOINT: Optional[str] = Field(
        description="URL of the Aliyun OSS endpoint for your chosen region",
        default=None,
    )

    ALIYUN_OSS_REGION: Optional[str] = Field(
        description="Aliyun OSS region where your bucket is located (e.g., 'oss-cn-hangzhou')",
        default=None,
    )

    ALIYUN_OSS_AUTH_VERSION: Optional[str] = Field(
        description="Version of the authentication protocol to use with Aliyun OSS (e.g., 'v4')",
        default=None,
    )

    ALIYUN_OSS_PATH: Optional[str] = Field(
        description="Base path within the bucket to store objects (e.g., 'my-app-data/')",
        default=None,
    )
