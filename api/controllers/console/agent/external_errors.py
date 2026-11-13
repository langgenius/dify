"""Stable Console verification failure reasons without exposing remote payloads."""

from fields.base import ResponseModel
from libs.exception import BaseHTTPException
from services.external_agents.contracts import VerificationFailureReason


class ExternalAgentVerificationFailureDetailsResponse(ResponseModel):
    reason: VerificationFailureReason


class ExternalAgentVerificationHTTPError(BaseHTTPException):
    code = 400
    error_code = "verification_failed"
    description = "External Agent verification failed."
    details_model = ExternalAgentVerificationFailureDetailsResponse

    def __init__(self, message: str, *, reason: VerificationFailureReason) -> None:
        super().__init__(description=message)
        assert self.data is not None
        self.data["details"] = ExternalAgentVerificationFailureDetailsResponse(reason=reason).model_dump(mode="json")
