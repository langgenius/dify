from __future__ import annotations
from pydantic import BaseModel


class DocumentRequestSegmentation(BaseModel):
    separator: str | None = None
    max_tokens: int | None = None

    @staticmethod
    def builder() -> DocumentRequestSegmentationBuilder:
        return DocumentRequestSegmentationBuilder()


class DocumentRequestSegmentationBuilder(object):
    def __init__(self):
        self._document_request_segmentation = DocumentRequestSegmentation()

    def build(self) -> DocumentRequestSegmentation:
        return self._document_request_segmentation

    def separator(self, separator: str) -> DocumentRequestSegmentationBuilder:
        self._document_request_segmentation.separator = separator
        return self

    def max_tokens(self, max_tokens: int) -> DocumentRequestSegmentationBuilder:
        self._document_request_segmentation.max_tokens = max_tokens
        return self
