from typing import Optional

from pydantic import BaseModel, Field


class HuaweiCloudOBSStorageConfig(BaseModel):
    """
    Configuration settings for Huawei Cloud Object Storage Service (OBS)
    """

    HUAWEI_OBS_BUCKET_NAME: Optional[str] = Field(
        description="Name of the Huawei Cloud OBS bucket to store and retrieve objects (e.g., 'my-obs-bucket')",
        default=None,
    )

    HUAWEI_OBS_ACCESS_KEY: Optional[str] = Field(
        description="Access Key ID for authenticating with Huawei Cloud OBS",
        default=None,
    )

    HUAWEI_OBS_SECRET_KEY: Optional[str] = Field(
        description="Secret Access Key for authenticating with Huawei Cloud OBS",
        default=None,
    )

    HUAWEI_OBS_SERVER: Optional[str] = Field(
        description="Endpoint URL for Huawei Cloud OBS (e.g., 'https://obs.cn-north-4.myhuaweicloud.com')",
        default=None,
    )
