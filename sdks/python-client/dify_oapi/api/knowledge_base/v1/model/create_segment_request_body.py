from __future__ import annotations
from pydantic import BaseModel
from .create_segment_request_body_segment import CreateSegmentRequestBodySegment


class CreateSegmentRequestBody(BaseModel):
    segments: list[CreateSegmentRequestBodySegment] | None = None

    @staticmethod
    def builder() -> CreateSegmentRequestBodyBuilder:
        return CreateSegmentRequestBodyBuilder()


class CreateSegmentRequestBodyBuilder(object):
    def __init__(self):
        self._create_segment_request_body = CreateSegmentRequestBody()

    def build(self) -> CreateSegmentRequestBody:
        return self._create_segment_request_body

    def segments(
        self, segments: list[CreateSegmentRequestBodySegment]
    ) -> CreateSegmentRequestBodyBuilder:
        self._create_segment_request_body.segments = segments
        return self
