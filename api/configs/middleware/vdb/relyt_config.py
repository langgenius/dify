from typing import Optional

from pydantic import Field, PositiveInt
from pydantic_settings import BaseSettings


class RelytConfig(BaseSettings):
    """
    Configuration settings for Relyt database
    """

    RELYT_HOST: Optional[str] = Field(
        description="Hostname or IP address of the Relyt server (e.g., 'localhost' or 'relyt.example.com')",
        default=None,
    )

    RELYT_PORT: PositiveInt = Field(
        description="Port number on which the Relyt server is listening (default is 9200)",
        default=9200,
    )

    RELYT_USER: Optional[str] = Field(
        description="Username for authenticating with the Relyt database",
        default=None,
    )

    RELYT_PASSWORD: Optional[str] = Field(
        description="Password for authenticating with the Relyt database",
        default=None,
    )

    RELYT_DATABASE: Optional[str] = Field(
        description="Name of the Relyt database to connect to (default is 'default')",
        default="default",
    )
