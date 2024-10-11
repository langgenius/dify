from typing import Optional

from pydantic import Field, PositiveInt
from pydantic_settings import BaseSettings


class ElasticsearchConfig(BaseSettings):
    """
    Configuration settings for Elasticsearch
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

    NUM_CANDIDATES: PositiveInt = Field(
        description="The number of nearest neighbor candidates to consider per shard. Cannot exceed 10000."
                    "Increasing num_candidates tends to improve the accuracy of the final k results,"
                    " but it will cost more time.",
        default=10,
    )
