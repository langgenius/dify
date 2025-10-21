from pydantic import Field, PositiveInt
from pydantic_settings import BaseSettings


class ChromaConfig(BaseSettings):
    """
    Configuration settings for Chroma vector database
    """

    CHROMA_HOST: str | None = Field(
        description="Hostname or IP address of the Chroma server (e.g., 'localhost' or '192.168.1.100')",
        default=None,
    )

    CHROMA_PORT: PositiveInt = Field(
        description="Port number on which the Chroma server is listening (default is 8000)",
        default=8000,
    )

    CHROMA_TENANT: str | None = Field(
        description="Tenant identifier for multi-tenancy support in Chroma",
        default=None,
    )

    CHROMA_DATABASE: str | None = Field(
        description="Name of the Chroma database to connect to",
        default=None,
    )

    CHROMA_AUTH_PROVIDER: str | None = Field(
        description="Authentication provider for Chroma (e.g., 'basic', 'token', or a custom provider)",
        default=None,
    )

    CHROMA_AUTH_CREDENTIALS: str | None = Field(
        description="Authentication credentials for Chroma (format depends on the auth provider)",
        default=None,
    )
