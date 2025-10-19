import json

from flask_restx import Resource, reqparse

from controllers.console.wraps import setup_required
from controllers.inner_api import inner_api_ns
from controllers.inner_api.wraps import enterprise_inner_api_only
from events.tenant_event import tenant_was_created
from extensions.ext_database import db
from models import Account
from services.account_service import TenantService


@inner_api_ns.route("/enterprise/workspace")
class EnterpriseWorkspace(Resource):
    @setup_required
    @enterprise_inner_api_only
    @inner_api_ns.doc("create_enterprise_workspace")
    @inner_api_ns.doc(description="Create a new enterprise workspace with owner assignment")
    @inner_api_ns.doc(
        responses={
            200: "Workspace created successfully",
            401: "Unauthorized - invalid API key",
            404: "Owner account not found or service not available",
        }
    )
    def post(self):
        parser = (
            reqparse.RequestParser()
            .add_argument("name", type=str, required=True, location="json")
            .add_argument("owner_email", type=str, required=True, location="json")
        )
        args = parser.parse_args()

        account = db.session.query(Account).filter_by(email=args["owner_email"]).first()
        if account is None:
            return {"message": "owner account not found."}, 404

        tenant = TenantService.create_tenant(args["name"], is_from_dashboard=True)
        TenantService.create_tenant_member(tenant, account, role="owner")

        tenant_was_created.send(tenant)

        resp = {
            "id": tenant.id,
            "name": tenant.name,
            "plan": tenant.plan,
            "status": tenant.status,
            "created_at": tenant.created_at.isoformat() + "Z" if tenant.created_at else None,
            "updated_at": tenant.updated_at.isoformat() + "Z" if tenant.updated_at else None,
        }

        return {
            "message": "enterprise workspace created.",
            "tenant": resp,
        }


@inner_api_ns.route("/enterprise/workspace/ownerless")
class EnterpriseWorkspaceNoOwnerEmail(Resource):
    @setup_required
    @enterprise_inner_api_only
    @inner_api_ns.doc("create_enterprise_workspace_ownerless")
    @inner_api_ns.doc(description="Create a new enterprise workspace without initial owner assignment")
    @inner_api_ns.doc(
        responses={
            200: "Workspace created successfully",
            401: "Unauthorized - invalid API key",
            404: "Service not available",
        }
    )
    def post(self):
        parser = reqparse.RequestParser().add_argument("name", type=str, required=True, location="json")
        args = parser.parse_args()

        tenant = TenantService.create_tenant(args["name"], is_from_dashboard=True)

        tenant_was_created.send(tenant)

        resp = {
            "id": tenant.id,
            "name": tenant.name,
            "encrypt_public_key": tenant.encrypt_public_key,
            "plan": tenant.plan,
            "status": tenant.status,
            "custom_config": json.loads(tenant.custom_config) if tenant.custom_config else {},
            "created_at": tenant.created_at.isoformat() + "Z" if tenant.created_at else None,
            "updated_at": tenant.updated_at.isoformat() + "Z" if tenant.updated_at else None,
        }

        return {
            "message": "enterprise workspace created.",
            "tenant": resp,
        }
