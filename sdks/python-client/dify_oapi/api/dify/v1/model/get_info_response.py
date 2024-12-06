from dify_oapi.core.model.base_response import BaseResponse


class GetInfoResponse(BaseResponse):
    name: str | None = None
    description: str | None = None
    tags: list[str] | None = None
