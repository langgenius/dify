from pydantic import Field
from pydantic_settings import BaseSettings


class BaiduOBSStorageConfig(BaseSettings):
    """
    Configuration settings for Baidu Object Storage Service (OBS)
    """

    BAIDU_OBS_BUCKET_NAME: str | None = Field(
        description="Name of the Baidu OBS bucket to store and retrieve objects (e.g., 'my-obs-bucket')",
        default=None,
    )

    BAIDU_OBS_ACCESS_KEY: str | None = Field(
        description="Access Key ID for authenticating with Baidu OBS",
        default=None,
    )

    BAIDU_OBS_SECRET_KEY: str | None = Field(
        description="Secret Access Key for authenticating with Baidu OBS",
        default=None,
    )

    BAIDU_OBS_ENDPOINT: str | None = Field(
        description="URL of the Baidu OSS endpoint for your chosen region (e.g., 'https://.bj.bcebos.com')",
        default=None,
    )
