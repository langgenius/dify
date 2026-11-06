from pydantic import Field, PositiveInt
from pydantic_settings import BaseSettings


class DXMTConfig(BaseSettings):
    """
    Configuration settings for the DXMT vector database
    """

    DXMT_HOST: str | None = Field(
        description="Hostname or IP address of the DXMT server (e.g., 'localhost' or 'dxmt')",
        default=None,
    )

    DXMT_PORT: PositiveInt = Field(
        description="Port number on which the DXMT server is listening (default is 9999)",
        default=9999,
    )

    DXMT_SSL: bool = Field(
        description="Whether to connect to the DXMT server over HTTPS",
        default=False,
    )

    DXMT_API_KEY: str | None = Field(
        description="API key for the DXMT server, if it was started with DXMT_API_KEY",
        default=None,
    )

    DXMT_TEXT_ANALYZER: str = Field(
        description="Analyzer for the full-text index: 'standard', or 'chinese' for jieba word segmentation",
        default="standard",
    )
