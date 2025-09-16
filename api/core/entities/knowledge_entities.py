from pydantic import BaseModel


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
