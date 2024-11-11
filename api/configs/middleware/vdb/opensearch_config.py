from typing import Optional

from pydantic import Field, PositiveInt
from pydantic_settings import BaseSettings


class OpenSearchConfig(BaseSettings):
    """
    Configuration settings for OpenSearch
    """

    OPENSEARCH_HOST: Optional[str] = Field(
        description="Hostname or IP address of the OpenSearch server (e.g., 'localhost' or 'opensearch.example.com')",
        default=None,
    )

    OPENSEARCH_PORT: PositiveInt = Field(
        description="Port number on which the OpenSearch server is listening (default is 9200)",
        default=9200,
    )

    OPENSEARCH_USER: Optional[str] = Field(
        description="Username for authenticating with OpenSearch",
        default=None,
    )

    OPENSEARCH_PASSWORD: Optional[str] = Field(
        description="Password for authenticating with OpenSearch",
        default=None,
    )

    OPENSEARCH_SECURE: bool = Field(
        description="Whether to use SSL/TLS encrypted connection for OpenSearch (True for HTTPS, False for HTTP)",
        default=False,
    )
