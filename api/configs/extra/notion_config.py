from typing import Optional

from pydantic import Field
from pydantic_settings import BaseSettings


class NotionConfig(BaseSettings):
    """
    Configuration settings for Notion integration
    """

    NOTION_CLIENT_ID: Optional[str] = Field(
        description="Client ID for Notion API authentication. Required for OAuth 2.0 flow.",
        default=None,
    )

    NOTION_CLIENT_SECRET: Optional[str] = Field(
        description="Client secret for Notion API authentication. Required for OAuth 2.0 flow.",
        default=None,
    )

    NOTION_INTEGRATION_TYPE: Optional[str] = Field(
        description="Type of Notion integration."
        " Set to 'internal' for internal integrations, or None for public integrations.",
        default=None,
    )

    NOTION_INTERNAL_SECRET: Optional[str] = Field(
        description="Secret key for internal Notion integrations. Required when NOTION_INTEGRATION_TYPE is 'internal'.",
        default=None,
    )

    NOTION_INTEGRATION_TOKEN: Optional[str] = Field(
        description="Integration token for Notion API access. Used for direct API calls without OAuth flow.",
        default=None,
    )
