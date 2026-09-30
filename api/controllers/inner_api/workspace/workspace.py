from flask_restx import Resource
from pydantic import BaseModel

from controllers.common.errors import InvalidArgumentError
from controllers.common.schema import register_schema_models
from controllers.console.wraps import setup_required, validate_request
from controllers.inner_api import inner_api_ns
from controllers.inner_api.wraps import inner_api_only
from enums.account import TenantAccountRole
from extensions.ext_application_services import application_services
from services.account_errors import AccountNotFoundError
from services.errors.workspace import (
    InvalidWorkspaceMemberRoleError,
    WorkspaceNotFoundError,
    WorkspaceOwnerNotFoundError,
    WorkspacesLimitExceededError,
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
    @inner_api_only
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
        args = validate_request(WorkspaceCreatePayload)
        try:
            tenant = application_services().workspaces.provisioning.create(name=args.name, owner_email=args.owner_email)
        except WorkspaceOwnerNotFoundError:
            return {"message": "owner account not found."}, 404
        except WorkspacesLimitExceededError as exc:
            raise InvalidArgumentError(str(exc)) from exc
        return {
            "message": "enterprise workspace created.",
            "tenant": {
                "id": tenant.id,
                "name": tenant.name,
                "plan": tenant.plan,
                "status": tenant.status,
                "created_at": tenant.created_at.isoformat() + "Z" if tenant.created_at else None,
                "updated_at": tenant.updated_at.isoformat() + "Z" if tenant.updated_at else None,
            },
        }


@inner_api_ns.route("/enterprise/workspace/ownerless")
class EnterpriseWorkspaceNoOwnerEmail(Resource):
    @setup_required
    @inner_api_only
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
        args = validate_request(WorkspaceOwnerlessPayload)
        tenant = application_services().workspaces.provisioning.create(name=args.name)
        return {
            "message": "enterprise workspace created.",
            "tenant": {
                "id": tenant.id,
                "name": tenant.name,
                "encrypt_public_key": tenant.encrypt_public_key,
                "plan": tenant.plan,
                "status": tenant.status,
                "custom_config": tenant.custom_config,
                "created_at": tenant.created_at.isoformat() + "Z" if tenant.created_at else None,
                "updated_at": tenant.updated_at.isoformat() + "Z" if tenant.updated_at else None,
            },
        }


@inner_api_ns.route("/enterprise/workspace/member")
class EnterpriseWorkspaceMember(Resource):
    @setup_required
    @inner_api_only
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
        args = validate_request(WorkspaceMemberPayload)
        try:
            member = application_services().workspaces.provisioning.join_member(
                workspace_id=args.workspace_id,
                account_id=args.account_id,
                email=args.email,
                role=args.role,
                operator_account_id=args.operator_account_id,
            )
        except InvalidWorkspaceMemberRoleError as exc:
            return {"message": str(exc)}, 400
        except WorkspaceNotFoundError:
            return {"message": "workspace not found."}, 404
        except AccountNotFoundError:
            return {"message": "account not found."}, 404
        return {
            "message": "enterprise workspace member joined.",
            "member": {
                "workspace_id": member.workspace_id,
                "account_id": member.account_id,
                "role": member.role,
            },
        }
