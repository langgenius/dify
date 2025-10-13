from flask import request
from flask_restx import Resource, reqparse

from libs.helper import extract_remote_ip
from libs.login import current_user, login_required
from models.account import Account
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
        assert isinstance(current_user, Account)
        assert current_user.current_tenant_id is not None
        parser = reqparse.RequestParser()
        parser.add_argument("doc_name", type=str, required=True, location="args")
        args = parser.parse_args()

        ip_address = extract_remote_ip(request)
        device_info = request.headers.get("User-Agent", "Unknown device")
        assert isinstance(current_user, Account)
        assert current_user.current_tenant_id
        return BillingService.get_compliance_download_link(
            doc_name=args.doc_name,
            account_id=current_user.id,
            tenant_id=current_user.current_tenant_id,
            ip=ip_address,
            device_info=device_info,
        )
