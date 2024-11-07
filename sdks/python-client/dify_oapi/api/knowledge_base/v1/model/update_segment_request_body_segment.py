from __future__ import annotations
from pydantic import BaseModel


class UpdateSegmentRequestBodySegment(BaseModel):
    content: str | None = None
    answer: str | None = None
    keywords: list | None = None
    enabled: bool | None = None

    @staticmethod
    def builder() -> UpdateSegmentRequestBodySegmentBuilder:
        return UpdateSegmentRequestBodySegmentBuilder()


class UpdateSegmentRequestBodySegmentBuilder(object):
    def __init__(self):
        self._update_segment_request_body_segment = UpdateSegmentRequestBodySegment()

    def build(self) -> UpdateSegmentRequestBodySegment:
        return self._update_segment_request_body_segment

    def content(self, content: str) -> UpdateSegmentRequestBodySegmentBuilder:
        self._update_segment_request_body_segment.content = content
        return self

    def answer(self, answer: str) -> UpdateSegmentRequestBodySegmentBuilder:
        self._update_segment_request_body_segment.answer = answer
        return self

    def keywords(self, keywords: list[str]) -> UpdateSegmentRequestBodySegmentBuilder:
        self._update_segment_request_body_segment.keywords = keywords
        return self

    def enabled(self, enabled: bool) -> UpdateSegmentRequestBodySegmentBuilder:
        self._update_segment_request_body_segment.enabled = enabled
        return self
