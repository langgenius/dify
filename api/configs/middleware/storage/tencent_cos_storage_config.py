from typing import Optional

from pydantic import Field
from pydantic_settings import BaseSettings


class TencentCloudCOSStorageConfig(BaseSettings):
    """
    Tencent Cloud COS storage configs
    """

    TENCENT_COS_BUCKET_NAME: Optional[str] = Field(
        description='Tencent Cloud COS bucket name',
        default=None,
    )

    TENCENT_COS_REGION: Optional[str] = Field(
        description='Tencent Cloud COS region',
        default=None,
    )

    TENCENT_COS_SECRET_ID: Optional[str] = Field(
        description='Tencent Cloud COS secret id',
        default=None,
    )

    TENCENT_COS_SECRET_KEY: Optional[str] = Field(
        description='Tencent Cloud COS secret key',
        default=None,
    )

    TENCENT_COS_SCHEME: Optional[str] = Field(
        description='Tencent Cloud COS scheme',
        default=None,
    )
