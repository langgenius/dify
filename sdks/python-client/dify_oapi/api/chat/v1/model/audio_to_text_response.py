from dify_oapi.core.model.base_response import BaseResponse


class AudioToTextResponse(BaseResponse):
    text: str | None = None
