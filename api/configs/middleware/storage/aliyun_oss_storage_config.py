from pydantic import Field
from pydantic_settings import BaseSettings


class AliyunOSSStorageConfig(BaseSettings):
    """
    Configuration settings for Aliyun Object Storage Service (OSS)
    """

    ALIYUN_OSS_BUCKET_NAME: str | None = Field(
        description="Name of the Aliyun OSS bucket to store and retrieve objects",
        default=None,
    )

    ALIYUN_OSS_ACCESS_KEY: str | None = Field(
        description="Access key ID for authenticating with Aliyun OSS",
        default=None,
    )

    ALIYUN_OSS_SECRET_KEY: str | None = Field(
        description="Secret access key for authenticating with Aliyun OSS",
        default=None,
    )

    ALIYUN_OSS_ENDPOINT: str | None = Field(
        description="URL of the Aliyun OSS endpoint for your chosen region",
        default=None,
    )

    ALIYUN_OSS_REGION: str | None = Field(
        description="Aliyun OSS region where your bucket is located (e.g., 'oss-cn-hangzhou')",
        default=None,
    )

    ALIYUN_OSS_AUTH_VERSION: str | None = Field(
        description="Version of the authentication protocol to use with Aliyun OSS (e.g., 'v4')",
        default=None,
    )

    ALIYUN_OSS_PATH: str | None = Field(
        description="Base path within the bucket to store objects (e.g., 'my-app-data/')",
        default=None,
    )

    ALIYUN_CLOUDBOX_ID: str | None = Field(
        description="Cloudbox id for aliyun cloudbox service",
        default=None,
    )
