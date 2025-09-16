from pydantic import Field
from pydantic_settings import BaseSettings


class NotionConfig(BaseSettings):
    """
    Configuration settings for Notion integration
    """

    NOTION_CLIENT_ID: str | None = Field(
        description="Client ID for Notion API authentication. Required for OAuth 2.0 flow.",
        default=None,
    )

    NOTION_CLIENT_SECRET: str | None = Field(
        description="Client secret for Notion API authentication. Required for OAuth 2.0 flow.",
        default=None,
    )

    NOTION_INTEGRATION_TYPE: str | None = Field(
        description="Type of Notion integration."
        " Set to 'internal' for internal integrations, or None for public integrations.",
        default=None,
    )

    NOTION_INTERNAL_SECRET: str | None = Field(
        description="Secret key for internal Notion integrations. Required when NOTION_INTEGRATION_TYPE is 'internal'.",
        default=None,
    )

    NOTION_INTEGRATION_TOKEN: str | None = Field(
        description="Integration token for Notion API access. Used for direct API calls without OAuth flow.",
        default=None,
    )
