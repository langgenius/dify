from pydantic import Field
from pydantic_settings import BaseSettings


class VolcengineTOSStorageConfig(BaseSettings):
    """
    Configuration settings for Volcengine Torch Object Storage (TOS)
    """

    VOLCENGINE_TOS_BUCKET_NAME: str | None = Field(
        description="Name of the Volcengine TOS bucket to store and retrieve objects (e.g., 'my-tos-bucket')",
        default=None,
    )

    VOLCENGINE_TOS_ACCESS_KEY: str | None = Field(
        description="Access Key ID for authenticating with Volcengine TOS",
        default=None,
    )

    VOLCENGINE_TOS_SECRET_KEY: str | None = Field(
        description="Secret Access Key for authenticating with Volcengine TOS",
        default=None,
    )

    VOLCENGINE_TOS_ENDPOINT: str | None = Field(
        description="URL of the Volcengine TOS endpoint (e.g., 'https://tos-cn-beijing.volces.com')",
        default=None,
    )

    VOLCENGINE_TOS_REGION: str | None = Field(
        description="Volcengine region where the TOS bucket is located (e.g., 'cn-beijing')",
        default=None,
    )
