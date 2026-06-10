from pydantic import Field
from pydantic_settings import BaseSettings


class TencentCloudCOSStorageConfig(BaseSettings):
    """
    Configuration settings for Tencent Cloud Object Storage (COS)
    """

    TENCENT_COS_BUCKET_NAME: str | None = Field(
        description="Name of the Tencent Cloud COS bucket to store and retrieve objects",
        default=None,
    )

    TENCENT_COS_REGION: str | None = Field(
        description="Tencent Cloud region where the COS bucket is located (e.g., 'ap-guangzhou')",
        default=None,
    )

    TENCENT_COS_SECRET_ID: str | None = Field(
        description="SecretId for authenticating with Tencent Cloud COS (part of API credentials)",
        default=None,
    )

    TENCENT_COS_SECRET_KEY: str | None = Field(
        description="SecretKey for authenticating with Tencent Cloud COS (part of API credentials)",
        default=None,
    )

    TENCENT_COS_SCHEME: str | None = Field(
        description="Protocol scheme for COS requests: 'https' (recommended) or 'http'",
        default=None,
    )

    TENCENT_COS_CUSTOM_DOMAIN: str | None = Field(
        description="Tencent Cloud COS custom domain setting",
        default=None,
    )
