from pydantic import Field
from pydantic_settings import BaseSettings


class ClickzettaConfig(BaseSettings):
    """
    Clickzetta Lakehouse vector database configuration
    """

    CLICKZETTA_USERNAME: str | None = Field(
        description="Username for authenticating with Clickzetta Lakehouse",
        default=None,
    )

    CLICKZETTA_PASSWORD: str | None = Field(
        description="Password for authenticating with Clickzetta Lakehouse",
        default=None,
    )

    CLICKZETTA_INSTANCE: str | None = Field(
        description="Clickzetta Lakehouse instance ID",
        default=None,
    )

    CLICKZETTA_SERVICE: str | None = Field(
        description="Clickzetta API service endpoint (e.g., 'api.clickzetta.com')",
        default="api.clickzetta.com",
    )

    CLICKZETTA_WORKSPACE: str | None = Field(
        description="Clickzetta workspace name",
        default="default",
    )

    CLICKZETTA_VCLUSTER: str | None = Field(
        description="Clickzetta virtual cluster name",
        default="default_ap",
    )

    CLICKZETTA_SCHEMA: str | None = Field(
        description="Database schema name in Clickzetta",
        default="public",
    )

    CLICKZETTA_BATCH_SIZE: int | None = Field(
        description="Batch size for bulk insert operations",
        default=100,
    )

    CLICKZETTA_ENABLE_INVERTED_INDEX: bool | None = Field(
        description="Enable inverted index for full-text search capabilities",
        default=True,
    )

    CLICKZETTA_ANALYZER_TYPE: str | None = Field(
        description="Analyzer type for full-text search: keyword, english, chinese, unicode",
        default="chinese",
    )

    CLICKZETTA_ANALYZER_MODE: str | None = Field(
        description="Analyzer mode for tokenization: max_word (fine-grained) or smart (intelligent)",
        default="smart",
    )

    CLICKZETTA_VECTOR_DISTANCE_FUNCTION: str | None = Field(
        description="Distance function for vector similarity: l2_distance or cosine_distance",
        default="cosine_distance",
    )
