from typing import Optional

from pydantic import Field, PositiveInt
from pydantic_settings import BaseSettings


class ChromaConfig(BaseSettings):
    """
    Chroma configs
    """

    CHROMA_HOST: Optional[str] = Field(
        description="Chroma host",
        default=None,
    )

    CHROMA_PORT: PositiveInt = Field(
        description="Chroma port",
        default=8000,
    )

    CHROMA_TENANT: Optional[str] = Field(
        description="Chroma database",
        default=None,
    )

    CHROMA_DATABASE: Optional[str] = Field(
        description="Chroma database",
        default=None,
    )

    CHROMA_AUTH_PROVIDER: Optional[str] = Field(
        description="Chroma authentication provider",
        default=None,
    )

    CHROMA_AUTH_CREDENTIALS: Optional[str] = Field(
        description="Chroma authentication credentials",
        default=None,
    )
