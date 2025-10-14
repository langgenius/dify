"""ClickZetta Volume Storage Configuration"""

from pydantic import Field
from pydantic_settings import BaseSettings


class ClickZettaVolumeStorageConfig(BaseSettings):
    """Configuration for ClickZetta Volume storage."""

    CLICKZETTA_VOLUME_USERNAME: str | None = Field(
        description="Username for ClickZetta Volume authentication",
        default=None,
    )

    CLICKZETTA_VOLUME_PASSWORD: str | None = Field(
        description="Password for ClickZetta Volume authentication",
        default=None,
    )

    CLICKZETTA_VOLUME_INSTANCE: str | None = Field(
        description="ClickZetta instance identifier",
        default=None,
    )

    CLICKZETTA_VOLUME_SERVICE: str = Field(
        description="ClickZetta service endpoint",
        default="api.clickzetta.com",
    )

    CLICKZETTA_VOLUME_WORKSPACE: str = Field(
        description="ClickZetta workspace name",
        default="quick_start",
    )

    CLICKZETTA_VOLUME_VCLUSTER: str = Field(
        description="ClickZetta virtual cluster name",
        default="default_ap",
    )

    CLICKZETTA_VOLUME_SCHEMA: str = Field(
        description="ClickZetta schema name",
        default="dify",
    )

    CLICKZETTA_VOLUME_TYPE: str = Field(
        description="ClickZetta volume type (table|user|external)",
        default="user",
    )

    CLICKZETTA_VOLUME_NAME: str | None = Field(
        description="ClickZetta volume name for external volumes",
        default=None,
    )

    CLICKZETTA_VOLUME_TABLE_PREFIX: str = Field(
        description="Prefix for ClickZetta volume table names",
        default="dataset_",
    )

    CLICKZETTA_VOLUME_DIFY_PREFIX: str = Field(
        description="Directory prefix for User Volume to organize Dify files",
        default="dify_km",
    )
