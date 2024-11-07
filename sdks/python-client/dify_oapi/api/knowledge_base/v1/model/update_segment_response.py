from dify_oapi.core.model.base_response import BaseResponse
from .segment import Segment


class UpdateSegmentResponse(BaseResponse):
    data: Segment | None = None
    doc_form: str | None = None
