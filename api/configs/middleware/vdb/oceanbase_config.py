from typing import Optional

from pydantic import Field, PositiveInt
from pydantic_settings import BaseSettings


class OceanBaseVectorConfig(BaseSettings):
    """
    Configuration settings for OceanBase Vector database
    """

    OCEANBASE_VECTOR_HOST: Optional[str] = Field(
        description="Hostname or IP address of the OceanBase Vector server (e.g. 'localhost')",
        default=None,
    )

    OCEANBASE_VECTOR_PORT: Optional[PositiveInt] = Field(
        description="Port number on which the OceanBase Vector server is listening (default is 2881)",
        default=2881,
    )

    OCEANBASE_VECTOR_USER: Optional[str] = Field(
        description="Username for authenticating with the OceanBase Vector database",
        default=None,
    )

    OCEANBASE_VECTOR_PASSWORD: Optional[str] = Field(
        description="Password for authenticating with the OceanBase Vector database",
        default=None,
    )

    OCEANBASE_VECTOR_DATABASE: Optional[str] = Field(
        description="Name of the OceanBase Vector database to connect to",
        default=None,
    )
