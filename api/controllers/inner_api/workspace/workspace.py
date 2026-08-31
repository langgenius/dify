import json

from flask_restx import Resource
from pydantic import BaseModel
from sqlalchemy import select

from controllers.common.schema import register_schema_models
from controllers.console.wraps import setup_required
from controllers.inner_api import inner_api_ns
from controllers.inner_api.wraps import enterprise_inner_api_only
from events.tenant_event import tenant_was_created
from extensions.ext_database import db
from models import Account
from models.account import TenantAccountRole
from services.account_service import (
    EnterpriseWorkspaceMemberAccountNotFoundError,
    EnterpriseWorkspaceMemberWorkspaceNotFoundError,
    TenantService,
)


class WorkspaceCreatePayload(BaseModel):
    name: str
    owner_email: str


class WorkspaceOwnerlessPayload(BaseModel):
    name: str


class WorkspaceMemberPayload(BaseModel):
    workspace_id: str
    account_id: str
    email: str
    role: str = TenantAccountRole.NORMAL.value
    current: bool = False
    operator_account_id: str | None = None


register_schema_models(inner_api_ns, WorkspaceCreatePayload, WorkspaceOwnerlessPayload, WorkspaceMemberPayload)


@inner_api_ns.route("/enterprise/workspace")
class EnterpriseWorkspace(Resource):
    @setup_required
    @enterprise_inner_api_only
    @inner_api_ns.doc("create_enterprise_workspace")
    @inner_api_ns.doc(description="Create a new enterprise workspace with owner assignment")
    @inner_api_ns.expect(inner_api_ns.models[WorkspaceCreatePayload.__name__])
    @inner_api_ns.doc(
        responses={
            200: "Workspace created successfully",
            401: "Unauthorized - invalid API key",
            404: "Owner account not found or service not available",
        }
    )
    def post(self):
        args = WorkspaceCreatePayload.model_validate(inner_api_ns.payload or {})

        account = db.session.scalar(select(Account).where(Account.email == args.owner_email).limit(1))
        if account is None:
            return {"message": "owner account not found."}, 404

        tenant = TenantService.create_owner_tenant(
            account,
            name=args.name,
            is_from_dashboard=True,
            session=db.session(),
        )

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
    @inner_api_ns.expect(inner_api_ns.models[WorkspaceOwnerlessPayload.__name__])
    @inner_api_ns.doc(
        responses={
            200: "Workspace created successfully",
            401: "Unauthorized - invalid API key",
            404: "Service not available",
        }
    )
    def post(self):
        args = WorkspaceOwnerlessPayload.model_validate(inner_api_ns.payload or {})

        tenant = TenantService.create_tenant(args.name, is_from_dashboard=True, session=db.session())

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


@inner_api_ns.route("/enterprise/workspace/member")
class EnterpriseWorkspaceMember(Resource):
    @setup_required
    @enterprise_inner_api_only
    @inner_api_ns.doc("join_enterprise_workspace_member")
    @inner_api_ns.doc(description="Add an existing account to an enterprise workspace")
    @inner_api_ns.expect(inner_api_ns.models[WorkspaceMemberPayload.__name__])
    @inner_api_ns.doc(
        responses={
            200: "Workspace member joined successfully",
            400: "Invalid workspace member role",
            401: "Unauthorized - invalid API key",
            404: "Workspace or account not found",
        }
    )
    def post(self):
        args = WorkspaceMemberPayload.model_validate(inner_api_ns.payload or {})

        try:
            role = TenantAccountRole(args.role)
        except ValueError:
            return {"message": "invalid workspace member role."}, 400
        if role == TenantAccountRole.OWNER:
            return {"message": "cannot join workspace as owner."}, 400

        try:
            membership = TenantService.join_enterprise_workspace_member(
                workspace_id=args.workspace_id,
                account_id=args.account_id,
                email=args.email,
                role=role,
                operator_account_id=args.operator_account_id,
            )
        except EnterpriseWorkspaceMemberWorkspaceNotFoundError:
            return {"message": "workspace not found."}, 404
        except EnterpriseWorkspaceMemberAccountNotFoundError:
            return {"message": "account not found."}, 404

        return {
            "message": "enterprise workspace member joined.",
            "member": {
                "workspace_id": membership.tenant_id,
                "account_id": membership.account_id,
                "role": membership.role.value,
            },
        }
