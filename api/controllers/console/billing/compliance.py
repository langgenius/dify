from typing import assert_never

from flask import request
from flask_restx import Resource
from pydantic import BaseModel, Field

from controllers.common.schema import (
    query_params_from_model,
    register_response_schema_models,
    register_schema_models,
)
from controllers.console import console_ns
from controllers.console.billing.error import (
    BillingOperationFailedError,
    BillingOperationFailedErrorResponse,
    BillingRequestInProgressError,
    BillingUnavailableError,
    BillingUnavailableErrorResponse,
    BillingUnprocessableEntityErrorResponse,
    ComplianceDocumentNotFoundError,
    ComplianceDownloadForbiddenError,
    ComplianceRateLimitError,
    ComplianceRateLimitErrorResponse,
    to_billing_request_error,
)
from controllers.console.flask_admission import console_account_admission
from controllers.console.wraps import model_validate
from enums import DeploymentEdition
from extensions.ext_application_services import application_services
from fields.base import ResponseModel
from libs.exception import BaseHTTPException
from libs.external_api import error_responses
from libs.helper import dump_response, extract_remote_ip
from machinery.context import RequestContext
from services.billing_client import billing
from services.errors.billing import ComplianceRateLimitExceededError, UnknownErrorReason


class ComplianceDownloadQuery(BaseModel):
    doc_name: str = Field(..., description="Compliance document name")


class ComplianceDownloadResponse(ResponseModel):
    url: str


register_schema_models(console_ns, ComplianceDownloadQuery)
register_response_schema_models(
    console_ns,
    BillingOperationFailedErrorResponse,
    BillingUnavailableErrorResponse,
    BillingUnprocessableEntityErrorResponse,
    ComplianceDownloadResponse,
    ComplianceRateLimitErrorResponse,
)


def _compliance_download_error(error: billing.UpstreamError) -> BaseHTTPException:
    match error.reason:
        case "COMPLIANCE_DOCUMENT_NOT_FOUND":
            return ComplianceDocumentNotFoundError()
        case "COMPLIANCE_DOWNLOAD_FORBIDDEN":
            return ComplianceDownloadForbiddenError()
        case "REQUEST_IN_PROGRESS":
            return BillingRequestInProgressError()
        case (
            ""
            | "CODEC"
            | "VALIDATOR"
            | "UNKNOWN"
            | "INVALID_SECRET_KEY"
            | "MISSING_TENANT_ID"
            | "INVALID_TENANT_ID"
            | "MISSING_ACCOUNT_ID"
            | "INVALID_ACCOUNT_ID"
            | "MISSING_PREFILLED_EMAIL"
            | "INVALID_PAYMENT_LINK_REQUEST"
            | "MISSING_PLAN"
            | "MISSING_INTERVAL"
            | "INVALID_PLAN_INTERVAL"
            | "CREATE_SUBSCRIPTION_PAYMENT_LINK_FAILED"
            | "INVALID_KNOWLEDGE_RATE_LIMIT_REQUEST"
            | "TENANT_IDS_COUNT_TOO_LARGE"
            | "DOCUMENT_USAGE_UNAVAILABLE"
            | "EDUCATION_VERIFY_FAILED"
            | "EDUCATION_CREATE_FAILED"
            | "EDUCATION_STATUS_FAILED"
            | "INVALID_INVOICE_REQUEST"
            | "CREATE_INVOICE_PORTAL_FAILED"
            | "INVALID_COMPLIANCE_DOWNLOAD_REQUEST"
            | "MISSING_DOC_NAME"
            | "MISSING_IP_ADDRESS"
            | "MISSING_DEVICE_INFO"
            | "COMPLIANCE_DOWNLOAD_FAILED"
            | "INVALID_MODEL_PROVIDER_PAYMENT_LINK_REQUEST"
            | "MISSING_PROVIDER_NAME"
            | "INVALID_MODEL_PROVIDER"
            | "CREATE_MODEL_PROVIDER_PAYMENT_LINK_FAILED"
            | "BILLING_COUPON_AMOUNT_OFF_INVALID"
            | "BILLING_COUPON_CURRENCY_INVALID"
            | "BILLING_COUPON_DISCOUNT_TYPE_INVALID"
            | "BILLING_COUPON_DURATION_MISMATCH"
            | "BILLING_COUPON_DURATION_MONTHS_INVALID"
            | "BILLING_COUPON_DURATION_MONTHS_MISMATCH"
            | "BILLING_COUPON_DURATION_UNSUPPORTED"
            | "BILLING_COUPON_EXPIRES_AFTER_COUPON"
            | "BILLING_COUPON_EXPIRES_AT_INVALID"
            | "BILLING_COUPON_ID_EMPTY"
            | "BILLING_COUPON_NOT_FOUND"
            | "BILLING_COUPON_PERCENT_OFF_INVALID"
            | "BILLING_COUPON_PRODUCT_NOT_FOUND"
            | "BILLING_COUPON_PRODUCT_PRICE_NOT_CONFIGURED"
            | "BILLING_COUPON_PRODUCT_SCOPE_INVALID"
            | "BILLING_COUPON_PRODUCT_SCOPE_MISMATCH"
            | "BILLING_COUPON_PRODUCT_SERVICE_NOT_CONFIGURED"
            | "BILLING_COUPON_PROMOTION_CODE_INVALID"
            | "BILLING_COUPON_QUANTITY_INVALID"
            | "BILLING_COUPON_QUANTITY_TOO_LARGE"
            | "BILLING_COUPON_STRIPE_NOT_CONFIGURED"
            | "BILLING_COUPON_TASK_ID_REQUIRED"
            | "BILLING_COUPON_TASK_NOT_CONFIGURED"
            | "BILLING_COUPON_TASK_NOT_FOUND"
            | "BILLING_COUPON_TASK_PUBLISHER_NOT_CONFIGURED"
            | "BILLING_COUPON_TASK_REPO_NOT_CONFIGURED"
            | "BILLING_COUPON_TICKET_ID_REQUIRED"
            | "BILLING_COUPON_USAGE_REPO_NOT_CONFIGURED"
            | "BILLING_REFUND_AMOUNT_INVALID"
            | "BILLING_REFUND_INVOICE_MISMATCH"
            | "BILLING_REFUND_INVOICE_NOT_FOUND"
            | "BILLING_REFUND_MODE_INVALID"
            | "BILLING_REFUND_NOT_REFUNDABLE"
            | "BILLING_REFUND_PAYMENT_NOT_FOUND"
            | "BILLING_REFUND_STRIPE_STATUS_NOT_FOUND"
            | "BILLING_REFUND_SUBSCRIPTION_NOT_FOUND"
            | "BILLING_REFUND_TICKET_ID_REQUIRED"
        ):
            return to_billing_request_error(error)
        case UnknownErrorReason() | None:
            return to_billing_request_error(error)
        case unreachable:
            assert_never(unreachable)


@console_ns.route("/compliance/download")
class ComplianceApi(Resource):
    @error_responses(
        BillingOperationFailedError,
        BillingRequestInProgressError,
        BillingUnavailableError,
        ComplianceDocumentNotFoundError,
        ComplianceDownloadForbiddenError,
        ComplianceRateLimitError,
    )
    @console_ns.doc(params=query_params_from_model(ComplianceDownloadQuery))
    @console_ns.doc("download_compliance_document")
    @console_ns.doc(description="Get compliance document download link")
    @console_ns.response(200, "Success", console_ns.models[ComplianceDownloadResponse.__name__])
    @console_ns.response(
        422,
        "Invalid compliance download query",
        console_ns.models[BillingUnprocessableEntityErrorResponse.__name__],
    )
    @console_ns.response(
        429,
        "Compliance download rate limit exceeded",
        console_ns.models[ComplianceRateLimitErrorResponse.__name__],
    )
    @console_ns.response(
        502,
        "Compliance download failed",
        console_ns.models[BillingOperationFailedErrorResponse.__name__],
    )
    @console_ns.response(
        503,
        "Billing unavailable",
        console_ns.models[BillingUnavailableErrorResponse.__name__],
    )
    @console_account_admission(editions=frozenset({DeploymentEdition.CLOUD}))
    @model_validate(ComplianceDownloadQuery)
    def get(self, req_data: ComplianceDownloadQuery, request_context: RequestContext):
        ip_address = extract_remote_ip(request)
        device_info = request.headers.get("User-Agent", "Unknown device")
        try:
            data = application_services().compliance_downloads.get_link(
                request_context=request_context,
                document_name=req_data.doc_name,
                ip_address=ip_address,
                device_info=device_info,
            )
        except ComplianceRateLimitExceededError as error:
            raise ComplianceRateLimitError() from error
        except billing.UpstreamError as error:
            raise _compliance_download_error(error) from error
        return dump_response(ComplianceDownloadResponse, data)
