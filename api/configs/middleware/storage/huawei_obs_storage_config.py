from typing import Optional

from pydantic import BaseModel, Field


class HuaweiCloudOBSStorageConfig(BaseModel):
    """
    Huawei Cloud OBS storage configs
    """

    HUAWEI_OBS_BUCKET_NAME: Optional[str] = Field(
        description="Huawei Cloud OBS bucket name",
        default=None,
    )

    HUAWEI_OBS_ACCESS_KEY: Optional[str] = Field(
        description="Huawei Cloud OBS Access key",
        default=None,
    )

    HUAWEI_OBS_SECRET_KEY: Optional[str] = Field(
        description="Huawei Cloud OBS Secret key",
        default=None,
    )

    HUAWEI_OBS_SERVER: Optional[str] = Field(
        description="Huawei Cloud OBS server URL",
        default=None,
    )
