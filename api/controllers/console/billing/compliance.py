from flask import request
from flask_restx import Resource
from pydantic import BaseModel, Field

from controllers.common.schema import query_params_from_model
from libs.helper import extract_remote_ip
from libs.login import login_required
from models import Account
from services.billing_service import BillingService

from ...common.schema import DEFAULT_REF_TEMPLATE_OPENAPI_3_0
from .. import console_ns
from ..wraps import (
    account_initialization_required,
    only_edition_cloud,
    setup_required,
    with_current_tenant_id,
    with_current_user,
)


class ComplianceDownloadQuery(BaseModel):
    doc_name: str = Field(..., description="Compliance document name")


console_ns.schema_model(
    ComplianceDownloadQuery.__name__,
    ComplianceDownloadQuery.model_json_schema(ref_template=DEFAULT_REF_TEMPLATE_OPENAPI_3_0),
)


@console_ns.route("/compliance/download")
class ComplianceApi(Resource):
    @console_ns.doc(params=query_params_from_model(ComplianceDownloadQuery))
    @console_ns.doc("download_compliance_document")
    @console_ns.doc(description="Get compliance document download link")
    @setup_required
    @login_required
    @account_initialization_required
    @only_edition_cloud
    @with_current_user
    @with_current_tenant_id
    def get(self, current_tenant_id: str, current_user: Account):
        args = ComplianceDownloadQuery.model_validate(request.args.to_dict(flat=True))

        ip_address = extract_remote_ip(request)
        device_info = request.headers.get("User-Agent", "Unknown device")
        return BillingService.get_compliance_download_link(
            doc_name=args.doc_name,
            account_id=current_user.id,
            tenant_id=current_tenant_id,
            ip=ip_address,
            device_info=device_info,
        )
