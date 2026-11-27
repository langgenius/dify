"""Stable Console verification failure reasons without exposing remote payloads."""

from dataclasses import asdict

from pydantic import Field

from fields.base import ResponseModel
from libs.exception import BaseHTTPException
from services.external_agents.contracts import (
    AgentCardFieldError,
    VerificationFailureReason,
    VerificationFailureSubreason,
)


class ExternalAgentCardFieldErrorResponse(ResponseModel):
    path: str
    code: str = Field(description="Safe validation code: missing or invalid. Ignore unknown future codes.")


class ExternalAgentVerificationFailureDetailsResponse(ResponseModel):
    reason: VerificationFailureReason
    subreason: str | None = Field(
        default=None, description="Optional evidence-backed refinement. Unknown values fall back to reason."
    )
    card_errors: list[ExternalAgentCardFieldErrorResponse] | None = None


class ExternalAgentVerificationHTTPError(BaseHTTPException):
    code = 400
    error_code = "verification_failed"
    description = "External Agent verification failed."
    details_model = ExternalAgentVerificationFailureDetailsResponse

    def __init__(
        self,
        message: str,
        *,
        reason: VerificationFailureReason,
        subreason: VerificationFailureSubreason | None = None,
        card_errors: tuple[AgentCardFieldError, ...] = (),
    ) -> None:
        """Serialize safe diagnostics, omitting absent refinements for old callers.

        Pre: the service supplies validated identifiers. Post: HTTP status/code
        and the four reason alternatives stay stable; optional codes remain open
        strings so future refinements cannot invalidate older generated clients.
        """
        super().__init__(description=message)
        assert self.data is not None
        self.data["details"] = ExternalAgentVerificationFailureDetailsResponse(
            reason=reason,
            subreason=subreason,
            card_errors=[ExternalAgentCardFieldErrorResponse(**asdict(error)) for error in card_errors]
            if card_errors
            else None,
        ).model_dump(mode="json", exclude_none=True)
