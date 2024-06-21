from typing import Optional

from pydantic import BaseModel, Field, PositiveInt


class OpenSearchConfigs(BaseModel):
    """
    OpenSearch configs
    """

    OPENSEARCH_HOST: Optional[str] = Field(
        description='OpenSearch host',
        default=None,
    )

    OPENSEARCH_PORT: PositiveInt = Field(
        description='OpenSearch port',
        default=9200,
    )

    OPENSEARCH_USER: Optional[str] = Field(
        description='OpenSearch user',
        default=None,
    )

    OPENSEARCH_PASSWORD: Optional[str] = Field(
        description='OpenSearch password',
        default=None,
    )

    OPENSEARCH_SECURE: bool = Field(
        description='whether to use SSL connection for OpenSearch',
        default=False,
    )
