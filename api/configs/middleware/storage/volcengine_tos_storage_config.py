from typing import Optional

from pydantic import BaseModel, Field


class VolcengineTOSStorageConfig(BaseModel):
    """
    Volcengine tos storage configs
    """

    VOLCENGINE_TOS_BUCKET_NAME: Optional[str] = Field(
        description="Volcengine TOS Bucket Name",
        default=None,
    )

    VOLCENGINE_TOS_ACCESS_KEY: Optional[str] = Field(
        description="Volcengine TOS Access Key",
        default=None,
    )

    VOLCENGINE_TOS_SECRET_KEY: Optional[str] = Field(
        description="Volcengine TOS Secret Key",
        default=None,
    )

    VOLCENGINE_TOS_ENDPOINT: Optional[str] = Field(
        description="Volcengine TOS Endpoint URL",
        default=None,
    )

    VOLCENGINE_TOS_REGION: Optional[str] = Field(
        description="Volcengine TOS Region",
        default=None,
    )
