"""HTTP errors shared by the Human Input v2 approval transports."""

from typing import override

from controllers.common.errors import NotFoundError
from libs.exception import BaseHTTPException
from services.human_input_v2.email_otp_service import EmailOtpError, OtpFailure
from services.human_input_v2.submission_service import HumanInputFormError, HumanInputFormErrorCode


class HumanInputV2AlreadySubmittedError(BaseHTTPException):
    error_code = "already_submitted"
    code = 409


class HumanInputV2ExpiredError(BaseHTTPException):
    error_code = "expired"
    code = 410


class HumanInputV2WorkflowNotActiveError(BaseHTTPException):
    error_code = "workflow_not_active"
    code = 409


class HumanInputV2InvalidInputError(BaseHTTPException):
    error_code = "invalid_input"
    code = 400


class PublicHumanInputV2NotFoundError(BaseHTTPException):
    error_code = "human_input_form_not_found"
    code = 404


class PublicHumanInputV2ExpiredError(BaseHTTPException):
    error_code = "human_input_form_expired"
    code = 412


class PublicHumanInputV2SubmittedError(BaseHTTPException):
    error_code = "human_input_form_submitted"
    code = 412


class HumanInputAccessRateLimitError(BaseHTTPException):
    error_code = "human_input_access_rate_limit_exceeded"
    code = 429

    def __init__(self, *, retry_after: int | None) -> None:
        super().__init__(description="Unable to complete email verification.")
        self._retry_after = retry_after

    @override
    def get_headers(self, environ=None, scope=None):
        headers = super().get_headers(environ, scope)
        if self._retry_after is not None:
            headers.append(("Retry-After", str(self._retry_after)))
        return headers


class HumanInputAccessDeliveryError(BaseHTTPException):
    error_code = "human_input_access_delivery_failed"
    code = 503


class HumanInputV2UnavailableError(BaseHTTPException):
    error_code = "human_input_v2_unavailable"
    code = 503


class HumanInputInvalidOtpError(BaseHTTPException):
    error_code = "human_input_invalid_otp"
    code = 400


class HumanInputStaleChallengeError(BaseHTTPException):
    error_code = "human_input_challenge_stale"
    code = 400


class HumanInputExpiredChallengeError(BaseHTTPException):
    error_code = "human_input_challenge_expired"
    code = 400


def form_http_error(error: HumanInputFormError, *, message: str) -> BaseHTTPException:
    error_type = {
        HumanInputFormErrorCode.NOT_FOUND: NotFoundError,
        HumanInputFormErrorCode.ALREADY_SUBMITTED: HumanInputV2AlreadySubmittedError,
        HumanInputFormErrorCode.EXPIRED: HumanInputV2ExpiredError,
        HumanInputFormErrorCode.WORKFLOW_NOT_ACTIVE: HumanInputV2WorkflowNotActiveError,
        HumanInputFormErrorCode.INVALID_INPUT: HumanInputV2InvalidInputError,
    }[error.code]
    return error_type(description=message)


def public_form_http_error(error: HumanInputFormError) -> BaseHTTPException:
    error_type = {
        HumanInputFormErrorCode.NOT_FOUND: PublicHumanInputV2NotFoundError,
        HumanInputFormErrorCode.ALREADY_SUBMITTED: PublicHumanInputV2SubmittedError,
        HumanInputFormErrorCode.EXPIRED: PublicHumanInputV2ExpiredError,
        HumanInputFormErrorCode.WORKFLOW_NOT_ACTIVE: HumanInputV2WorkflowNotActiveError,
        HumanInputFormErrorCode.INVALID_INPUT: HumanInputV2InvalidInputError,
    }[error.code]
    return error_type(description="The form is unavailable or the submission could not be accepted.")


def email_otp_http_error(error: EmailOtpError) -> BaseHTTPException:
    if error.reason == OtpFailure.RATE_LIMIT:
        return HumanInputAccessRateLimitError(retry_after=error.retry_after)
    error_type = {
        OtpFailure.NOT_FOUND: PublicHumanInputV2NotFoundError,
        OtpFailure.EXPIRED: PublicHumanInputV2ExpiredError,
        OtpFailure.SUBMITTED: PublicHumanInputV2SubmittedError,
        OtpFailure.DELIVERY: HumanInputAccessDeliveryError,
        OtpFailure.UNAVAILABLE: HumanInputV2UnavailableError,
        OtpFailure.INVALID: HumanInputInvalidOtpError,
        OtpFailure.STALE: HumanInputStaleChallengeError,
        OtpFailure.CHALLENGE_EXPIRED: HumanInputExpiredChallengeError,
    }[error.reason]
    return error_type(description="Unable to complete email verification.")
