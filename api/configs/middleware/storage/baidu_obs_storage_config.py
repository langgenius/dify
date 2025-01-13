from typing import Optional

from pydantic import Field
from pydantic_settings import BaseSettings


class BaiduOBSStorageConfig(BaseSettings):
    """
    Configuration settings for Baidu Object Storage Service (OBS)
    """

    BAIDU_OBS_BUCKET_NAME: Optional[str] = Field(
        description="Name of the Baidu OBS bucket to store and retrieve objects (e.g., 'my-obs-bucket')",
        default=None,
    )

    BAIDU_OBS_ACCESS_KEY: Optional[str] = Field(
        description="Access Key ID for authenticating with Baidu OBS",
        default=None,
    )

    BAIDU_OBS_SECRET_KEY: Optional[str] = Field(
        description="Secret Access Key for authenticating with Baidu OBS",
        default=None,
    )

    BAIDU_OBS_ENDPOINT: Optional[str] = Field(
        description="URL of the Baidu OSS endpoint for your chosen region (e.g., 'https://.bj.bcebos.com')",
        default=None,
    )
