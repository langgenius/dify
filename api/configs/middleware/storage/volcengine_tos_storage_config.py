from typing import Optional

from pydantic import BaseModel, Field


class VolcengineTOSStorageConfig(BaseModel):
    """
    Configuration settings for Volcengine Tinder Object Storage (TOS)
    """

    VOLCENGINE_TOS_BUCKET_NAME: Optional[str] = Field(
        description="Name of the Volcengine TOS bucket to store and retrieve objects (e.g., 'my-tos-bucket')",
        default=None,
    )

    VOLCENGINE_TOS_ACCESS_KEY: Optional[str] = Field(
        description="Access Key ID for authenticating with Volcengine TOS",
        default=None,
    )

    VOLCENGINE_TOS_SECRET_KEY: Optional[str] = Field(
        description="Secret Access Key for authenticating with Volcengine TOS",
        default=None,
    )

    VOLCENGINE_TOS_ENDPOINT: Optional[str] = Field(
        description="URL of the Volcengine TOS endpoint (e.g., 'https://tos-cn-beijing.volces.com')",
        default=None,
    )

    VOLCENGINE_TOS_REGION: Optional[str] = Field(
        description="Volcengine region where the TOS bucket is located (e.g., 'cn-beijing')",
        default=None,
    )
