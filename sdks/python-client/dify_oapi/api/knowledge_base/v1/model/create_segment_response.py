from __future__ import annotations


from dify_oapi.core.model.base_response import BaseResponse
from .segment import Segment


class CreateSegmentResponse(BaseResponse):
    data: list[Segment] | None = None
    doc_form: str | None = None
