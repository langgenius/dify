from pydantic import BaseModel, Field, field_validator


class PreviewDetail(BaseModel):
    content: str
    child_chunks: list[str] | None = None


class QAPreviewDetail(BaseModel):
    question: str
    answer: str


class IndexingEstimate(BaseModel):
    total_segments: int
    preview: list[PreviewDetail]
    qa_preview: list[QAPreviewDetail] | None = None


class PipelineDataset(BaseModel):
    id: str
    name: str
    description: str = Field(default="", description="knowledge dataset description")
    chunk_structure: str

    @field_validator("description", mode="before")
    @classmethod
    def normalize_description(cls, value: str | None) -> str:
        """Coerce None to empty string so description is always a string."""
        if value is None:
            return ""
        return value


class PipelineDocument(BaseModel):
    id: str
    position: int
    data_source_type: str
    data_source_info: dict | None = None
    name: str
    indexing_status: str
    error: str | None = None
    enabled: bool


class PipelineGenerateResponse(BaseModel):
    batch: str
    dataset: PipelineDataset
    documents: list[PipelineDocument]
