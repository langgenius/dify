from argparse import ArgumentParser

from flask import request
from flask_login import current_user  # type: ignore
from flask_restful import Resource  # type: ignore

from libs.helper import extract_remote_ip
from libs.login import login_required
from services.billing_service import BillingService

from .. import api
from ..wraps import account_initialization_required, only_edition_cloud, setup_required


class ComplianceListApi(Resource):
    @setup_required
    @login_required
    @account_initialization_required
    @only_edition_cloud
    def get(self):
        current_user_id = current_user.id
        current_tenant_id = current_user.current_tenant_id

        return BillingService.list_compliance_files(tenant_id=current_tenant_id, account_id=current_user_id)


class ComplianceApi(Resource):
    @setup_required
    @login_required
    @account_initialization_required
    @only_edition_cloud
    def get(self):
        parser = ArgumentParser()
        parser.add_argument("doc_name", type=str, required=True)
        args = parser.parse_args()

        ip_address = extract_remote_ip(request)
        device_info = request.headers.get("User-Agent", "Unknown device")

        current_user_id = current_user.id
        current_tenant_id = current_user.current_tenant_id

        return BillingService.get_compliance_download_link(
            doc_name=args.doc_name,
            account_id=current_user_id,
            tenant_id=current_tenant_id,
            ip=ip_address,
            device_info=device_info,
        )


api.add_resource(ComplianceListApi, "/compliance/list")
api.add_resource(ComplianceApi, "/compliance/download")
