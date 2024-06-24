from typing import Optional

from pydantic import BaseModel, Field


class FeishuWikiConfig(BaseModel):
    """
    Feishu wiki integration configs
    """
    FEISHU_APP_ID: Optional[str] = Field(
        description='Feishu app id',
        default=None,
    )

    FEISHU_APP_SECRET: Optional[str] = Field(
        description='Feishu app secret',
        default=None,
    )
