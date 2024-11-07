from dify_oapi.core.model.base_response import BaseResponse
from .segment import Segment


class ListSegmentResponse(BaseResponse):
    data: list[Segment] | None = None
    doc_form: str | None = None
