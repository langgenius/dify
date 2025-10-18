from flask import request
from flask_restx import Resource, reqparse

from libs.helper import extract_remote_ip
from libs.login import current_account_with_tenant, login_required
from services.billing_service import BillingService

from .. import console_ns
from ..wraps import account_initialization_required, only_edition_cloud, setup_required


@console_ns.route("/compliance/download")
class ComplianceApi(Resource):
    @setup_required
    @login_required
    @account_initialization_required
    @only_edition_cloud
    def get(self):
        current_user, current_tenant_id = current_account_with_tenant()
        parser = reqparse.RequestParser().add_argument("doc_name", type=str, required=True, location="args")
        args = parser.parse_args()

        ip_address = extract_remote_ip(request)
        device_info = request.headers.get("User-Agent", "Unknown device")
        return BillingService.get_compliance_download_link(
            doc_name=args.doc_name,
            account_id=current_user.id,
            tenant_id=current_tenant_id,
            ip=ip_address,
            device_info=device_info,
        )
