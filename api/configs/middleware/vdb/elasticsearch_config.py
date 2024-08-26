from typing import Optional

from pydantic import Field, PositiveInt
from pydantic_settings import BaseSettings


class ElasticsearchConfig(BaseSettings):
    """
    Elasticsearch configs
    """

    ELASTICSEARCH_HOST: Optional[str] = Field(
        description="Elasticsearch host",
        default="127.0.0.1",
    )

    ELASTICSEARCH_PORT: PositiveInt = Field(
        description="Elasticsearch port",
        default=9200,
    )

    ELASTICSEARCH_USERNAME: Optional[str] = Field(
        description="Elasticsearch username",
        default="elastic",
    )

    ELASTICSEARCH_PASSWORD: Optional[str] = Field(
        description="Elasticsearch password",
        default="elastic",
    )
