from typing import Literal

from fields.base import ResponseModel
from libs.exception import BaseHTTPException
from services.errors.billing import (
    BillingError,
    BillingUpstreamInvalidResponseError,
    BillingUpstreamUnavailableError,
)


class BillingUnprocessableEntityErrorResponse(ResponseModel):
    code: Literal["unprocessable_entity"]
    message: str
    status: Literal[422]


class ComplianceRateLimitErrorResponse(ResponseModel):
    code: Literal["compliance_rate_limit"]
    message: str
    status: Literal[429]


class BillingOperationFailedErrorResponse(ResponseModel):
    code: Literal["billing_operation_failed"]
    message: str
    status: Literal[502]


class BillingUnavailableErrorResponse(ResponseModel):
    code: Literal["billing_unavailable"]
    message: str
    status: Literal[503]


class ComplianceRateLimitError(BaseHTTPException):
    error_code = "compliance_rate_limit"
    description = "Rate limit exceeded for downloading compliance report."
    code = 429


class ComplianceDocumentNotFoundError(BaseHTTPException):
    error_code = "compliance_document_not_found"
    description = "The compliance document was not found."
    code = 404


class ComplianceDownloadForbiddenError(BaseHTTPException):
    error_code = "compliance_download_forbidden"
    description = "Your current plan does not allow downloading this compliance document."
    code = 403


class BillingRequestInProgressError(BaseHTTPException):
    error_code = "billing_request_in_progress"
    description = "A previous request is still being processed. Please try again shortly."
    code = 429


class BillingOperationFailedError(BaseHTTPException):
    error_code = "billing_operation_failed"
    description = "We couldn't complete this request. Please try again. If the problem persists, contact support."
    code = 502


class BillingUnavailableError(BaseHTTPException):
    error_code = "billing_unavailable"
    description = "This operation is temporarily unavailable. Please try again later."
    code = 503


def to_billing_request_error(error: BillingError) -> BaseHTTPException:
    if isinstance(error, BillingUpstreamInvalidResponseError):
        return BillingOperationFailedError()
    if isinstance(error, BillingUpstreamUnavailableError):
        return BillingUnavailableError()
    raise TypeError(f"Unsupported billing error: {type(error).__name__}")
