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
    BillingOperationFailedErrorResponse,
    BillingUnavailableErrorResponse,
    BillingUnprocessableEntityErrorResponse,
    ComplianceRateLimitErrorResponse,
    to_billing_request_error,
)
from controllers.console.flask_admission import console_account_admission
from controllers.console.wraps import model_validate
from enums import DeploymentEdition
from extensions.ext_application_services import application_services
from fields.base import ResponseModel
from libs.helper import dump_response, extract_remote_ip
from machinery.context import RequestContext
from services.errors.billing import BillingError


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


@console_ns.route("/compliance/download")
class ComplianceApi(Resource):
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
        except BillingError as error:
            raise to_billing_request_error(error) from error
        return dump_response(ComplianceDownloadResponse, data)
