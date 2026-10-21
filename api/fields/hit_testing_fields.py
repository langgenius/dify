from datetime import datetime
from typing import Annotated, Any, Literal

from pydantic import BaseModel, ConfigDict, Discriminator, Field, Tag, field_validator, model_validator

from fields.base import ResponseModel
from libs.helper import to_timestamp
from services.knowledge.entities.knowledge_entities import ExternalRetrievalModel, RetrievalModel


class HitTestingPayload(BaseModel):
    query: str = Field(description="Search query text.", max_length=250)
    retrieval_model: RetrievalModel | None = Field(
        default=None,
        description=(
            "Retrieval model configuration. Controls how chunks are searched and ranked when querying this "
            "knowledge base."
        ),
    )
    external_retrieval_model: ExternalRetrievalModel = Field(
        default=None,
        description="Retrieval settings for external knowledge bases.",
    )
    attachment_ids: list[str] | None = Field(
        default=None,
        description="List of attachment IDs to include in the retrieval context.",
    )


class HitTestingQuery(ResponseModel):
    content: str


class HitTestingDocument(ResponseModel):
    id: str
    data_source_type: str
    name: str
    doc_type: str | None
    doc_metadata: Any | None

    @field_validator("data_source_type", "doc_type", mode="before")
    @classmethod
    def _normalize_enum_fields(cls, value: Any) -> Any:
        return _normalize_enum(value)


class HitTestingSegment(ResponseModel):
    id: str
    position: int
    document_id: str
    content: str
    sign_content: str | None
    answer: str | None
    word_count: int
    tokens: int
    keywords: list[str]
    index_node_id: str | None
    index_node_hash: str | None
    hit_count: int
    enabled: bool
    disabled_at: int | None
    disabled_by: str | None
    status: str
    created_by: str
    created_at: int
    indexing_at: int | None
    completed_at: int | None
    error: str | None
    stopped_at: int | None
    document: HitTestingDocument = Field(description="Parent document information for the matched chunk.")

    @model_validator(mode="before")
    @classmethod
    def _normalize_collections(cls, value: Any) -> Any:
        if isinstance(value, dict):
            value = dict(value)
            value.setdefault("sign_content", None)
            if value.get("keywords") is None:
                value["keywords"] = []
        return value

    @field_validator("disabled_at", "created_at", "indexing_at", "completed_at", "stopped_at", mode="before")
    @classmethod
    def _normalize_timestamp(cls, value: datetime | int | None) -> int | None:
        return to_timestamp(value)

    @field_validator("status", mode="before")
    @classmethod
    def _normalize_enum_fields(cls, value: Any) -> Any:
        return _normalize_enum(value)


class HitTestingChildChunk(ResponseModel):
    id: str
    content: str
    position: int
    score: float


class HitTestingFile(ResponseModel):
    id: str
    name: str
    size: int
    extension: str
    mime_type: str
    source_url: str


class HitTestingRecord(ResponseModel):
    segment: HitTestingSegment = Field(description="Matched chunk from the knowledge base.")
    child_chunks: list[HitTestingChildChunk]
    score: float | None
    tsne_position: Any | None
    files: list[HitTestingFile]
    summary: str | None

    @model_validator(mode="before")
    @classmethod
    def _normalize_collections(cls, value: Any) -> Any:
        if isinstance(value, dict):
            value = dict(value)
            for name in ("child_chunks", "files"):
                if value.get(name) is None:
                    value[name] = []
            value.setdefault("tsne_position", None)
            value.setdefault("summary", None)
        return value


class ExternalHitTestingQueryResponse(ResponseModel):
    content: str


class ExternalHitTestingRecordResponse(ResponseModel):
    # Keep the two response branches disjoint: invalid internal records must not
    # pass after Pydantic discards their segment-specific fields.
    model_config = ConfigDict(extra="forbid")

    content: str | None = None
    title: str | None = None
    score: float | None = None
    metadata: dict[str, Any] | None = None


class ExternalHitTestingResponse(ResponseModel):
    query: ExternalHitTestingQueryResponse
    records: list[ExternalHitTestingRecordResponse]


def _record_source(record: Any) -> Literal["internal", "external"]:
    if isinstance(record, HitTestingRecord) or (isinstance(record, dict) and "segment" in record):
        return "internal"
    return "external"


HitTestingResultRecord = Annotated[
    Annotated[HitTestingRecord, Tag("internal")] | Annotated[ExternalHitTestingRecordResponse, Tag("external")],
    Discriminator(_record_source),
]


class HitTestingResponse(ResponseModel):
    query: HitTestingQuery = Field(description="The original query object.")
    records: list[HitTestingResultRecord]


def _normalize_enum(value: Any) -> Any:
    if isinstance(value, str) or value is None:
        return value
    return getattr(value, "value", value)
