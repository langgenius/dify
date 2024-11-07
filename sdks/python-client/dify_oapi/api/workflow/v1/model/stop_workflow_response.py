from dify_oapi.core.model.base_response import BaseResponse


class StopWorkflowResponse(BaseResponse):
    result: str | None = None
