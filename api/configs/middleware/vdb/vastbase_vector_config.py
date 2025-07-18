from typing import Optional

from pydantic import Field, PositiveInt
from pydantic_settings import BaseSettings


class VastbaseVectorConfig(BaseSettings):
    """
    Configuration settings for Vector (Vastbase with vector extension)
    """

    VASTBASE_HOST: Optional[str] = Field(
        description="Hostname or IP address of the Vastbase server with Vector extension (e.g., 'localhost')",
        default=None,
    )

    VASTBASE_PORT: PositiveInt = Field(
        description="Port number on which the Vastbase server is listening (default is 5432)",
        default=5432,
    )

    VASTBASE_USER: Optional[str] = Field(
        description="Username for authenticating with the Vastbase database",
        default=None,
    )

    VASTBASE_PASSWORD: Optional[str] = Field(
        description="Password for authenticating with the Vastbase database",
        default=None,
    )

    VASTBASE_DATABASE: Optional[str] = Field(
        description="Name of the Vastbase database to connect to",
        default=None,
    )

    VASTBASE_MIN_CONNECTION: PositiveInt = Field(
        description="Min connection of the Vastbase database",
        default=1,
    )

    VASTBASE_MAX_CONNECTION: PositiveInt = Field(
        description="Max connection of the Vastbase database",
        default=5,
    )
