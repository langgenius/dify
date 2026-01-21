from flask import request
from flask_restx import Resource
from pydantic import BaseModel, Field

from libs.helper import extract_remote_ip
from libs.login import current_account_with_tenant, login_required
from services.billing_service import BillingService

from .. import console_ns
from ..wraps import account_initialization_required, only_edition_cloud, setup_required


class ComplianceDownloadQuery(BaseModel):
    doc_name: str = Field(..., description="Compliance document name")


console_ns.schema_model(
    ComplianceDownloadQuery.__name__,
    ComplianceDownloadQuery.model_json_schema(ref_template="#/definitions/{model}"),
)


@console_ns.route("/compliance/download")
class ComplianceApi(Resource):
    @console_ns.expect(console_ns.models[ComplianceDownloadQuery.__name__])
    @console_ns.doc("download_compliance_document")
    @console_ns.doc(description="Get compliance document download link")
    @setup_required
    @login_required
    @account_initialization_required
    @only_edition_cloud
    def get(self):
        current_user, current_tenant_id = current_account_with_tenant()
        args = ComplianceDownloadQuery.model_validate(request.args.to_dict(flat=True))  # type: ignore

        ip_address = extract_remote_ip(request)
        device_info = request.headers.get("User-Agent", "Unknown device")
        return BillingService.get_compliance_download_link(
            doc_name=args.doc_name,
            account_id=current_user.id,
            tenant_id=current_tenant_id,
            ip=ip_address,
            device_info=device_info,
        )
