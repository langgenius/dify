from enum import StrEnum
from typing import Literal

from pydantic import Field, PositiveInt
from pydantic_settings import BaseSettings


class AuthMethod(StrEnum):
    """
    Authentication method for OpenSearch
    """

    BASIC = "basic"
    AWS_MANAGED_IAM = "aws_managed_iam"


class OpenSearchConfig(BaseSettings):
    """
    Configuration settings for OpenSearch
    """

    OPENSEARCH_HOST: str | None = Field(
        description="Hostname or IP address of the OpenSearch server (e.g., 'localhost' or 'opensearch.example.com')",
        default=None,
    )

    OPENSEARCH_PORT: PositiveInt = Field(
        description="Port number on which the OpenSearch server is listening (default is 9200)",
        default=9200,
    )

    OPENSEARCH_SECURE: bool = Field(
        description="Whether to use SSL/TLS encrypted connection for OpenSearch (True for HTTPS, False for HTTP)",
        default=False,
    )

    OPENSEARCH_VERIFY_CERTS: bool = Field(
        description="Whether to verify SSL certificates for HTTPS connections (recommended to set True in production)",
        default=True,
    )

    OPENSEARCH_AUTH_METHOD: AuthMethod = Field(
        description="Authentication method for OpenSearch connection (default is 'basic')",
        default=AuthMethod.BASIC,
    )

    OPENSEARCH_USER: str | None = Field(
        description="Username for authenticating with OpenSearch",
        default=None,
    )

    OPENSEARCH_PASSWORD: str | None = Field(
        description="Password for authenticating with OpenSearch",
        default=None,
    )

    OPENSEARCH_AWS_REGION: str | None = Field(
        description="AWS region for OpenSearch (e.g. 'us-west-2')",
        default=None,
    )

    OPENSEARCH_AWS_SERVICE: Literal["es", "aoss"] | None = Field(
        description="AWS service for OpenSearch (e.g. 'aoss' for OpenSearch Serverless)", default=None
    )
