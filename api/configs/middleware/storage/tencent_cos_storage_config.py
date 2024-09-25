from typing import Optional

from pydantic import Field
from pydantic_settings import BaseSettings


class TencentCloudCOSStorageConfig(BaseSettings):
    """
    Configuration settings for Tencent Cloud Object Storage (COS)
    """

    TENCENT_COS_BUCKET_NAME: Optional[str] = Field(
        description="Name of the Tencent Cloud COS bucket to store and retrieve objects",
        default=None,
    )

    TENCENT_COS_REGION: Optional[str] = Field(
        description="Tencent Cloud region where the COS bucket is located (e.g., 'ap-guangzhou')",
        default=None,
    )

    TENCENT_COS_SECRET_ID: Optional[str] = Field(
        description="SecretId for authenticating with Tencent Cloud COS (part of API credentials)",
        default=None,
    )

    TENCENT_COS_SECRET_KEY: Optional[str] = Field(
        description="SecretKey for authenticating with Tencent Cloud COS (part of API credentials)",
        default=None,
    )

    TENCENT_COS_SCHEME: Optional[str] = Field(
        description="Protocol scheme for COS requests: 'https' (recommended) or 'http'",
        default=None,
    )
