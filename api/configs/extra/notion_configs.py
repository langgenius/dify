from typing import Optional

from pydantic import BaseModel, Field


class NotionConfigs(BaseModel):
    """
    Notion integration configs
    """
    NOTION_CLIENT_ID: Optional[str] = Field(
        description='Notion client ID',
        default=None,
    )

    NOTION_CLIENT_SECRET: Optional[str] = Field(
        description='Notion client secret key',
        default=None,
    )

    NOTION_INTEGRATION_TYPE: Optional[str] = Field(
        description='Notion integration type, default to None, available values: internal.',
        default=None,
    )

    NOTION_INTERNAL_SECRET: Optional[str] = Field(
        description='Notion internal secret key',
        default=None,
    )

    NOTION_INTEGRATION_TOKEN: Optional[str] = Field(
        description='Notion integration token',
        default=None,
    )
