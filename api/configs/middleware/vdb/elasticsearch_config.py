from pydantic import Field, PositiveInt, model_validator
from pydantic_settings import BaseSettings


class ElasticsearchConfig(BaseSettings):
    """
    Configuration settings for both self-managed and Elastic Cloud deployments.
    Can load from environment variables or .env files.
    """

    ELASTICSEARCH_HOST: str | None = Field(
        description="Hostname or IP address of the Elasticsearch server (e.g., 'localhost' or '192.168.1.100')",
        default="127.0.0.1",
    )

    ELASTICSEARCH_PORT: PositiveInt = Field(
        description="Port number on which the Elasticsearch server is listening (default is 9200)",
        default=9200,
    )

    ELASTICSEARCH_USERNAME: str | None = Field(
        description="Username for authenticating with Elasticsearch (default is 'elastic')",
        default="elastic",
    )

    ELASTICSEARCH_PASSWORD: str | None = Field(
        description="Password for authenticating with Elasticsearch (default is 'elastic')",
        default="elastic",
    )

    # Elastic Cloud (optional)
    ELASTICSEARCH_USE_CLOUD: bool | None = Field(
        description="Set to True to use Elastic Cloud instead of self-hosted Elasticsearch", default=False
    )
    ELASTICSEARCH_CLOUD_URL: str | None = Field(
        description="Full URL for Elastic Cloud deployment (e.g., 'https://example.es.region.aws.found.io:443')",
        default=None,
    )
    ELASTICSEARCH_API_KEY: str | None = Field(description="API key for authenticating with Elastic Cloud", default=None)

    # Common options
    ELASTICSEARCH_CA_CERTS: str | None = Field(
        description="Path to CA certificate file for SSL verification", default=None
    )
    ELASTICSEARCH_VERIFY_CERTS: bool = Field(
        description="Whether to verify SSL certificates (default is False)", default=False
    )
    ELASTICSEARCH_REQUEST_TIMEOUT: int = Field(
        description="Request timeout in milliseconds (default is 100000)", default=100000
    )
    ELASTICSEARCH_RETRY_ON_TIMEOUT: bool = Field(
        description="Whether to retry requests on timeout (default is True)", default=True
    )
    ELASTICSEARCH_MAX_RETRIES: int = Field(
        description="Maximum number of retry attempts (default is 10000)", default=10000
    )

    @model_validator(mode="after")
    def validate_elasticsearch_config(self):
        """Validate Elasticsearch configuration based on deployment type."""
        if self.ELASTICSEARCH_USE_CLOUD:
            if not self.ELASTICSEARCH_CLOUD_URL:
                raise ValueError("ELASTICSEARCH_CLOUD_URL is required when using Elastic Cloud")
            if not self.ELASTICSEARCH_API_KEY:
                raise ValueError("ELASTICSEARCH_API_KEY is required when using Elastic Cloud")
        else:
            if not self.ELASTICSEARCH_HOST:
                raise ValueError("ELASTICSEARCH_HOST is required for self-hosted Elasticsearch")
            if not self.ELASTICSEARCH_USERNAME:
                raise ValueError("ELASTICSEARCH_USERNAME is required for self-hosted Elasticsearch")
            if not self.ELASTICSEARCH_PASSWORD:
                raise ValueError("ELASTICSEARCH_PASSWORD is required for self-hosted Elasticsearch")

        return self
