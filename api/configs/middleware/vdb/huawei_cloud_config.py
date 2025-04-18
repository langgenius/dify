from typing import Optional

from pydantic import Field
from pydantic_settings import BaseSettings


class HuaweiCloudConfig(BaseSettings):
    """
    Configuration settings for Huawei cloud search service
    """

    HUAWEI_CLOUD_HOSTS: Optional[str] = Field(
        description="Hostname or IP address of the Huawei cloud search service instance",
        default=None,
    )

    HUAWEI_CLOUD_USER: Optional[str] = Field(
        description="Username for authenticating with Huawei cloud search service",
        default=None,
    )

    HUAWEI_CLOUD_PASSWORD: Optional[str] = Field(
        description="Password for authenticating with Huawei cloud search service",
        default=None,
    )
