from typing import Literal, Optional

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

    OPENSEARCH_USE_AWS_MANAGED_IAM: bool = Field(
        description="Whether to use AWS IAM authentication for OpenSearch clusters "
        "running in Amazon Managed OpenSearch or OpenSearch Serverless",
        default=False,
    )

    OPENSEARCH_AWS_REGION: Optional[str] = Field(
        description="AWS region for OpenSearch (e.g. 'us-west-2')",
        default=None,
    )

    OPENSEARCH_AWS_SERVICE: Literal["es", "aoss"] = Field(
        description="AWS service for OpenSearch (e.g. 'aoss' for OpenSearch Serverless)",
        default="aoss"
    )
