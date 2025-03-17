from typing import Optional

from pydantic import Field, PositiveInt
from pydantic_settings import BaseSettings


class OpenGaussConfig(BaseSettings):
    """
    Configuration settings for OpenGauss
    """

    OPENGAUSS_HOST: Optional[str] = Field(
        description="Hostname or IP address of the OpenGauss server(e.g., 'localhost')",
        default=None,
    )

    OPENGAUSS_PORT: PositiveInt = Field(
        description="Port number on which the OpenGauss server is listening (default is 6600)",
        default=6600,
    )

    OPENGAUSS_USER: Optional[str] = Field(
        description="Username for authenticating with the OpenGauss database",
        default=None,
    )

    OPENGAUSS_PASSWORD: Optional[str] = Field(
        description="Password for authenticating with the OpenGauss database",
        default=None,
    )

    OPENGAUSS_DATABASE: Optional[str] = Field(
        description="Name of the OpenGauss database to connect to",
        default=None,
    )

    OPENGAUSS_MIN_CONNECTION: PositiveInt = Field(
        description="Min connection of the OpenGauss database",
        default=1,
    )

    OPENGAUSS_MAX_CONNECTION: PositiveInt = Field(
        description="Max connection of the OpenGauss database",
        default=5,
    )
