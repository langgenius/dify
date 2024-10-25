from typing import Optional

from pydantic import Field
from pydantic_settings import BaseSettings


class UpstashConfig(BaseSettings):
    """
    Configuration settings for Upstash vector database
    """

    UPSTASH_VECTOR_URL: Optional[str] = Field(
        description="URL of the upstash server (e.g., 'https://vector.upstash.io')",
        default=None,
    )

    UPSTASH_VECTOR_TOKEN: Optional[str] = Field(
        description="Token for authenticating with the upstash server",
        default=None,
    )
