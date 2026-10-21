from datetime import datetime
from typing import Any
from uuid import UUID

from flask_restx import Resource
from pydantic import BaseModel

from controllers.common.errors import InvalidArgumentError
from controllers.common.fields import SimpleMessageResponse
from controllers.common.schema import register_response_schema_models, register_schema_models
from controllers.console.wraps import setup_required, validate_request
from controllers.inner_api import inner_api_ns
from controllers.inner_api.wraps import inner_api_only
from enums.account import TenantAccountRole
from extensions.ext_application_services import application_services
from fields.base import ResponseModel
from services.account_errors import AccountNotFoundError
from services.errors.workspace import (
    InvalidWorkspaceMemberRoleError,
    WorkspaceInvitationQuotaError,
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


class WorkspaceResponse(ResponseModel):
    id: str
    name: str
    plan: str
    status: str
    created_at: str | None = None
    updated_at: str | None = None


class WorkspaceOwnerlessTenantResponse(WorkspaceResponse):
    encrypt_public_key: str | None = None
    custom_config: dict[str, Any]


class WorkspaceCreateResponse(ResponseModel):
    message: str
    tenant: WorkspaceResponse


class WorkspaceOwnerlessCreateResponse(ResponseModel):
    message: str
    tenant: WorkspaceOwnerlessTenantResponse


class WorkspaceMemberInfoResponse(ResponseModel):
    workspace_id: str
    account_id: str
    role: str


class WorkspaceMemberResponse(ResponseModel):
    message: str
    member: WorkspaceMemberInfoResponse


def _iso_utc(value: datetime | None) -> str | None:
    return value.isoformat() + "Z" if value else None


register_response_schema_models(
    inner_api_ns,
    WorkspaceResponse,
    WorkspaceOwnerlessTenantResponse,
    WorkspaceCreateResponse,
    WorkspaceOwnerlessCreateResponse,
    WorkspaceMemberResponse,
    SimpleMessageResponse,
)


@inner_api_ns.route("/enterprise/workspace")
class EnterpriseWorkspace(Resource):
    @setup_required
    @inner_api_only
    @inner_api_ns.doc("create_enterprise_workspace")
    @inner_api_ns.doc(description="Create a new enterprise workspace with owner assignment")
    @inner_api_ns.expect(inner_api_ns.models[WorkspaceCreatePayload.__name__])
    @inner_api_ns.response(200, "Workspace created successfully", inner_api_ns.models[WorkspaceCreateResponse.__name__])
    @inner_api_ns.response(404, "Owner account not found", inner_api_ns.models[SimpleMessageResponse.__name__])
    def post(self):
        args = validate_request(WorkspaceCreatePayload)
        try:
            tenant = application_services().workspaces.provisioning.create(name=args.name, owner_email=args.owner_email)
        except WorkspaceOwnerNotFoundError:
            return {"message": "owner account not found."}, 404
        except WorkspacesLimitExceededError as exc:
            raise InvalidArgumentError(str(exc)) from exc
        return WorkspaceCreateResponse(
            message="enterprise workspace created.",
            tenant=WorkspaceResponse(
                id=tenant.id,
                name=tenant.name,
                plan=tenant.plan,
                status=tenant.status,
                created_at=_iso_utc(tenant.created_at),
                updated_at=_iso_utc(tenant.updated_at),
            ),
        ).model_dump(mode="json")


@inner_api_ns.route("/enterprise/workspace/ownerless")
class EnterpriseWorkspaceNoOwnerEmail(Resource):
    @setup_required
    @inner_api_only
    @inner_api_ns.doc("create_enterprise_workspace_ownerless")
    @inner_api_ns.doc(description="Create a new enterprise workspace without initial owner assignment")
    @inner_api_ns.expect(inner_api_ns.models[WorkspaceOwnerlessPayload.__name__])
    @inner_api_ns.response(
        200, "Workspace created successfully", inner_api_ns.models[WorkspaceOwnerlessCreateResponse.__name__]
    )
    def post(self):
        args = validate_request(WorkspaceOwnerlessPayload)
        try:
            tenant = application_services().workspaces.provisioning.create(name=args.name)
        except WorkspacesLimitExceededError as exc:
            raise InvalidArgumentError(str(exc)) from exc
        return WorkspaceOwnerlessCreateResponse(
            message="enterprise workspace created.",
            tenant=WorkspaceOwnerlessTenantResponse(
                id=tenant.id,
                name=tenant.name,
                plan=tenant.plan,
                status=tenant.status,
                created_at=_iso_utc(tenant.created_at),
                updated_at=_iso_utc(tenant.updated_at),
                encrypt_public_key=tenant.encrypt_public_key,
                custom_config=tenant.custom_config,
            ),
        ).model_dump(mode="json")


@inner_api_ns.route("/enterprise/workspace/member")
class EnterpriseWorkspaceMember(Resource):
    @setup_required
    @inner_api_only
    @inner_api_ns.doc("join_enterprise_workspace_member")
    @inner_api_ns.doc(description="Add an existing account to an enterprise workspace")
    @inner_api_ns.expect(inner_api_ns.models[WorkspaceMemberPayload.__name__])
    @inner_api_ns.response(
        200, "Workspace member joined successfully", inner_api_ns.models[WorkspaceMemberResponse.__name__]
    )
    @inner_api_ns.response(400, "Invalid workspace member role", inner_api_ns.models[SimpleMessageResponse.__name__])
    @inner_api_ns.response(404, "Workspace or account not found", inner_api_ns.models[SimpleMessageResponse.__name__])
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
        except WorkspaceInvitationQuotaError as exc:
            raise InvalidArgumentError(str(exc)) from exc
        return WorkspaceMemberResponse(
            message="enterprise workspace member joined.",
            member=WorkspaceMemberInfoResponse(
                workspace_id=member.workspace_id,
                account_id=member.account_id,
                role=member.role,
            ),
        ).model_dump(mode="json")


@inner_api_ns.route("/enterprise/workspace/<uuid:workspace_id>/resources")
class EnterpriseWorkspaceResourceDeletion(Resource):
    @setup_required
    @inner_api_only
    @inner_api_ns.doc("delete_enterprise_workspace_resources")
    @inner_api_ns.doc(description="Schedule App, Dataset and Agent cleanup; retain the workspace and memberships")
    @inner_api_ns.response(202, "Cleanup accepted", inner_api_ns.models[SimpleMessageResponse.__name__])
    def delete(self, workspace_id: UUID):
        application_services().workspaces.resource_cleanup.cleanup(str(workspace_id))
        return SimpleMessageResponse(message="workspace resource cleanup accepted.").model_dump(mode="json"), 202
