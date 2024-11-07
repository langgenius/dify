from __future__ import annotations
from pydantic import BaseModel


class CreateSegmentRequestBodySegment(BaseModel):
    content: str | None = None
    answer: str | None = None
    keywords: list[str] | None = None

    @staticmethod
    def builder() -> CreateSegmentRequestBodySegmentBuilder:
        return CreateSegmentRequestBodySegmentBuilder()


class CreateSegmentRequestBodySegmentBuilder(object):
    def __init__(self):
        self._create_segment_request_body_segment = CreateSegmentRequestBodySegment()

    def build(self) -> CreateSegmentRequestBodySegment:
        return self._create_segment_request_body_segment

    def content(self, content: str) -> CreateSegmentRequestBodySegmentBuilder:
        self._create_segment_request_body_segment.content = content
        return self

    def answer(self, answer: str) -> CreateSegmentRequestBodySegmentBuilder:
        self._create_segment_request_body_segment.answer = answer
        return self

    def keywords(self, keywords: list[str]) -> CreateSegmentRequestBodySegmentBuilder:
        self._create_segment_request_body_segment.keywords = keywords
        return self
