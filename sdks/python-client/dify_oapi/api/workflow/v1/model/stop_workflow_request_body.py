from __future__ import annotations

from pydantic import BaseModel


class StopWorkflowRequestBody(BaseModel):
    user: str | None = None

    @staticmethod
    def builder() -> StopWorkflowRequestBodyBuilder:
        return StopWorkflowRequestBodyBuilder()


class StopWorkflowRequestBodyBuilder:
    def __init__(self):
        self._stop_workflow_request_body = StopWorkflowRequestBody()

    def user(self, user: str) -> StopWorkflowRequestBodyBuilder:
        self._stop_workflow_request_body.user = user
        return self

    def build(self) -> StopWorkflowRequestBody:
        return self._stop_workflow_request_body
