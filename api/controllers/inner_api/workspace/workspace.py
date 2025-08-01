import json

from flask_restful import Resource, reqparse

from controllers.console.wraps import setup_required
from controllers.inner_api import api
from controllers.inner_api.wraps import enterprise_inner_api_only
from core.tools.entities.tool_entities import CredentialType
from events.tenant_event import tenant_was_created
from extensions.ext_database import db
from libs.helper import StrLen
from models.account import Account
from services.account_service import TenantService
from services.tools.builtin_tools_manage_service import BuiltinToolManageService


class EnterpriseWorkspace(Resource):
    @setup_required
    @enterprise_inner_api_only
    def post(self):
        parser = reqparse.RequestParser()
        parser.add_argument("name", type=str, required=True, location="json")
        parser.add_argument("owner_email", type=str, required=True, location="json")
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


class EnterpriseWorkspaceNoOwnerEmail(Resource):
    @setup_required
    @enterprise_inner_api_only
    def post(self):
        parser = reqparse.RequestParser()
        parser.add_argument("name", type=str, required=True, location="json")
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


class EnterpriseWorkspaceCreateToolCredential(Resource):
    @setup_required
    @enterprise_inner_api_only
    def post(self):
        parser = reqparse.RequestParser()
        parser.add_argument("tenant_id", type=str, required=True, location="json")
        parser.add_argument("user_id", type=str, required=True, location="json")
        parser.add_argument("provider", type=str, required=True, location="json")
        parser.add_argument("credentials", type=dict, required=True, nullable=False, location="json")
        parser.add_argument("name", type=StrLen(30), required=False, nullable=False, location="json")
        parser.add_argument("type", type=str, required=True, nullable=False, location="json")
        args = parser.parse_args()

        if args["type"] not in CredentialType.values():
            raise ValueError(f"Invalid credential type: {args['type']}")

        return BuiltinToolManageService.add_builtin_tool_provider(
            user_id=args["user_id"],
            tenant_id=args["tenant_id"],
            provider=args["provider"],
            credentials=args["credentials"],
            name=args["name"],
            api_type=CredentialType.of(args["type"]),
        )


class EnterpriseWorkspaceUpdateToolCredential(Resource):
    @setup_required
    @enterprise_inner_api_only
    def post(self):
        parser = reqparse.RequestParser()
        parser.add_argument("credential_id", type=str, required=True, nullable=False, location="json")
        parser.add_argument("credentials", type=dict, required=False, nullable=True, location="json")
        parser.add_argument("name", type=StrLen(30), required=False, nullable=True, location="json")
        parser.add_argument("tenant_id", type=str, required=True, nullable=False, location="json")
        parser.add_argument("user_id", type=str, required=True, nullable=False, location="json")
        parser.add_argument("provider", type=str, required=True, nullable=False, location="json")
        args = parser.parse_args()

        args = parser.parse_args()
        result = BuiltinToolManageService.update_builtin_tool_provider(
            user_id=args["user_id"],
            tenant_id=args["tenant_id"],
            provider=args["provider"],
            credential_id=args["credential_id"],
            credentials=args.get("credentials", None),
            name=args.get("name", ""),
        )
        return result


api.add_resource(EnterpriseWorkspace, "/enterprise/workspace")
api.add_resource(EnterpriseWorkspaceNoOwnerEmail, "/enterprise/workspace/ownerless")
api.add_resource(EnterpriseWorkspaceCreateToolCredential, "/enterprise/workspace/tool/credential")
api.add_resource(EnterpriseWorkspaceUpdateToolCredential, "/enterprise/workspace/tool/credential/update")
