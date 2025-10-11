from pydantic import Field, PositiveInt
from pydantic_settings import BaseSettings


class OpenGaussConfig(BaseSettings):
    """
    Configuration settings for OpenGauss
    """

    OPENGAUSS_HOST: str | None = Field(
        description="Hostname or IP address of the OpenGauss server(e.g., 'localhost')",
        default=None,
    )

    OPENGAUSS_PORT: PositiveInt = Field(
        description="Port number on which the OpenGauss server is listening (default is 6600)",
        default=6600,
    )

    OPENGAUSS_USER: str | None = Field(
        description="Username for authenticating with the OpenGauss database",
        default=None,
    )

    OPENGAUSS_PASSWORD: str | None = Field(
        description="Password for authenticating with the OpenGauss database",
        default=None,
    )

    OPENGAUSS_DATABASE: str | None = Field(
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

    OPENGAUSS_ENABLE_PQ: bool = Field(
        description="Enable openGauss PQ acceleration feature",
        default=False,
    )
