from __future__ import annotations
from pydantic import BaseModel
from .update_segment_request_body_segment import UpdateSegmentRequestBodySegment


class UpdateSegmentRequestBody(BaseModel):
    segment: UpdateSegmentRequestBodySegment | None = None

    @staticmethod
    def builder() -> UpdateSegmentRequestBodyBuilder:
        return UpdateSegmentRequestBodyBuilder()


class UpdateSegmentRequestBodyBuilder(object):
    def __init__(self):
        self._update_segment_request_body = UpdateSegmentRequestBody()

    def build(self) -> UpdateSegmentRequestBody:
        return self._update_segment_request_body

    def segment(
        self, segment: UpdateSegmentRequestBodySegment
    ) -> UpdateSegmentRequestBodyBuilder:
        self._update_segment_request_body.segment = segment
        return self
