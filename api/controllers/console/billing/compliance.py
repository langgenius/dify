from flask import request
from flask_login import current_user  # type: ignore
from flask_restful import Resource, reqparse  # type: ignore

from libs.helper import extract_remote_ip
from libs.login import login_required
from services.billing_service import BillingService

from .. import api
from ..wraps import account_initialization_required, only_edition_cloud, setup_required


class ComplianceApi(Resource):
    @setup_required
    @login_required
    @account_initialization_required
    @only_edition_cloud
    def get(self):
        parser = reqparse.RequestParser()
        parser.add_argument("doc_name", type=str, required=True, location="args")
        args = parser.parse_args()

        ip_address = extract_remote_ip(request)
        device_info = request.headers.get("User-Agent", "Unknown device")

        return BillingService.get_compliance_download_link(
            doc_name=args.doc_name,
            account_id=current_user.id,
            tenant_id=current_user.current_tenant_id,
            ip=ip_address,
            device_info=device_info,
        )


api.add_resource(ComplianceApi, "/compliance/download")
