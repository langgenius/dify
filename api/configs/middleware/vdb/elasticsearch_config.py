from typing import Optional

from pydantic import Field, PositiveInt
from pydantic_settings import BaseSettings


class ElasticsearchConfig(BaseSettings):
    """
    Configuration settings for both self-managed and Elastic Cloud deployments.
    Can load from environment variables or .env files.
    """

    ELASTICSEARCH_HOST: Optional[str] = Field(
        description="Hostname or IP address of the Elasticsearch server (e.g., 'localhost' or '192.168.1.100')",
        default="127.0.0.1",
    )

    ELASTICSEARCH_PORT: PositiveInt = Field(
        description="Port number on which the Elasticsearch server is listening (default is 9200)",
        default=9200,
    )

    ELASTICSEARCH_USERNAME: Optional[str] = Field(
        description="Username for authenticating with Elasticsearch (default is 'elastic')",
        default="elastic",
    )

    ELASTICSEARCH_PASSWORD: Optional[str] = Field(
        description="Password for authenticating with Elasticsearch (default is 'elastic')",
        default="elastic",
    )

    # Elastic Cloud (optional)
    ELASTICSEARCH_USE_CLOUD: Optional[bool] = Field(default=False)
    ELASTICSEARCH_CLOUD_ID: Optional[str] = None
    ELASTICSEARCH_API_KEY: Optional[str] = None

    # Common options
    ELASTICSEARCH_CA_CERTS: Optional[str] = None
    ELASTICSEARCH_VERIFY_CERTS: bool = True
    ELASTICSEARCH_REQUEST_TIMEOUT: int = 100000
    ELASTICSEARCH_RETRY_ON_TIMEOUT: bool = True
    ELASTICSEARCH_MAX_RETRIES: int = 10000
