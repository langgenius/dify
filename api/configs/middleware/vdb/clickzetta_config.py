from typing import Optional

from pydantic import BaseModel, Field


class ClickzettaConfig(BaseModel):
    """
    Clickzetta Lakehouse vector database configuration
    """

    CLICKZETTA_USERNAME: Optional[str] = Field(
        description="Username for authenticating with Clickzetta Lakehouse",
        default=None,
    )

    CLICKZETTA_PASSWORD: Optional[str] = Field(
        description="Password for authenticating with Clickzetta Lakehouse",
        default=None,
    )

    CLICKZETTA_INSTANCE: Optional[str] = Field(
        description="Clickzetta Lakehouse instance ID",
        default=None,
    )

    CLICKZETTA_SERVICE: Optional[str] = Field(
        description="Clickzetta API service endpoint (e.g., 'api.clickzetta.com')",
        default="api.clickzetta.com",
    )

    CLICKZETTA_WORKSPACE: Optional[str] = Field(
        description="Clickzetta workspace name",
        default="default",
    )

    CLICKZETTA_VCLUSTER: Optional[str] = Field(
        description="Clickzetta virtual cluster name",
        default="default_ap",
    )

    CLICKZETTA_SCHEMA: Optional[str] = Field(
        description="Database schema name in Clickzetta",
        default="public",
    )

    CLICKZETTA_BATCH_SIZE: Optional[int] = Field(
        description="Batch size for bulk insert operations",
        default=100,
    )

    CLICKZETTA_ENABLE_INVERTED_INDEX: Optional[bool] = Field(
        description="Enable inverted index for full-text search capabilities",
        default=True,
    )

    CLICKZETTA_ANALYZER_TYPE: Optional[str] = Field(
        description="Analyzer type for full-text search: keyword, english, chinese, unicode",
        default="chinese",
    )

    CLICKZETTA_ANALYZER_MODE: Optional[str] = Field(
        description="Analyzer mode for tokenization: max_word (fine-grained) or smart (intelligent)",
        default="smart",
    )

    CLICKZETTA_VECTOR_DISTANCE_FUNCTION: Optional[str] = Field(
        description="Distance function for vector similarity: l2_distance or cosine_distance",
        default="cosine_distance",
    )
