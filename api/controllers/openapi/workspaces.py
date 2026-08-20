"""User-scoped workspace reads and member management under /openapi/v1/workspaces.

Bearer-authed counterparts to the cookie-authed /console/api/workspaces
endpoints. Account bearers (dfoa_) see every tenant they're a member of.
External SSO bearers (dfoe_) have no account_id and so see an empty list —
that matches /openapi/v1/account.

Member-management endpoints use ``guard_workspace`` which enforces
workspace membership and optional role requirements via the auth pipeline.
"""

from __future__ import annotations

from collections.abc import Sequence
from urllib import parse

from flask_restx import Resource
from sqlalchemy.orm import Session
from werkzeug.exceptions import BadRequest, Forbidden, NotFound

from configs import dify_config
from controllers.common.session import with_session
from controllers.openapi import openapi_ns
from controllers.openapi._contract import accepts, returns
from controllers.openapi._errors import MemberLicenseExceeded, MemberLimitExceeded
from controllers.openapi._models import (
    MemberActionResponse,
    MemberInvitePayload,
    MemberInviteResponse,
    MemberListQuery,
    MemberListResponse,
    MemberResponse,
    MemberRoleUpdatePayload,
    WorkspaceDetailResponse,
    WorkspaceListResponse,
    WorkspaceRoleResponse,
    WorkspaceSummaryResponse,
)
from controllers.openapi.auth.composition import auth_router
from controllers.openapi.auth.data import AuthData, RBACRequirement
from core.db.session_factory import session_factory
from core.rbac import RBACPermission, RBACResourceScope
from enums import DeploymentEdition
from extensions.ext_application_services import application_services
from libs.oauth_bearer import Scope, TokenType
from models.account import TenantAccountRole
from services.account_service import AccountService, RegisterService, TenantService
from services.errors.account import (
    AccountAlreadyInTenantError,
    AccountNotLinkTenantError,
    AccountRegisterError,
    CannotOperateSelfError,
    MemberNotInTenantError,
    NoPermissionError,
    RoleAlreadyAssignedError,
    SeatsLimitExceededError,
    WorkspaceMembersLimitExceededError,
)
from services.workspace_member_query_service import WorkspaceMemberRole, WorkspaceMemberSummary
from services.workspace_query_service import WorkspaceWithRoles


def _role_responses(roles: Sequence[WorkspaceMemberRole]) -> list[WorkspaceRoleResponse]:
    return [WorkspaceRoleResponse(id=role.id, name=role.name) for role in roles]


def _member_response(member: WorkspaceMemberSummary) -> MemberResponse:
    return MemberResponse(
        id=member.id,
        name=member.name,
        email=member.email,
        roles=_role_responses(member.roles),
        status=member.status,
        avatar=member.avatar,
    )


@openapi_ns.route("/workspaces")
class WorkspacesApi(Resource):
    @auth_router.guard(scope=Scope.WORKSPACE_READ, allowed_token_types=frozenset({TokenType.OAUTH_ACCOUNT}))
    @returns(200, WorkspaceListResponse, description="Workspace list")
    def get(self, *, auth_data: AuthData):
        assert auth_data.account_id is not None
        workspaces = application_services().workspace_queries.list_for_account_with_roles(str(auth_data.account_id))
        return WorkspaceListResponse(workspaces=[_workspace_summary(workspace) for workspace in workspaces])


@openapi_ns.route("/workspaces/<string:workspace_id>")
class WorkspaceByIdApi(Resource):
    @auth_router.guard(scope=Scope.WORKSPACE_READ, allowed_token_types=frozenset({TokenType.OAUTH_ACCOUNT}))
    @returns(200, WorkspaceDetailResponse, description="Workspace detail")
    def get(self, workspace_id: str, *, auth_data: AuthData):
        assert auth_data.account_id is not None
        workspace = application_services().workspace_queries.get_for_account_with_roles(
            str(auth_data.account_id), workspace_id
        )
        # 404 (not 403) on non-member so workspace IDs don't leak across tenants.
        if workspace is None:
            raise NotFound("workspace not found")
        return _workspace_detail(workspace)


@openapi_ns.route("/workspaces/<string:workspace_id>:switch")
class WorkspaceSwitchApi(Resource):
    """Server-side switch — equivalent to the console's POST /workspaces/switch.

    CLI `difyctl use workspace <id>` calls this; it does NOT mutate
    ``hosts.yml`` on its own. Failure here must abort the local write so
    that ``hosts.yml`` never diverges from the server's ``current`` state.
    """

    @auth_router.guard_workspace(scope=Scope.WORKSPACE_READ, allowed_token_types=frozenset({TokenType.OAUTH_ACCOUNT}))
    @returns(200, WorkspaceDetailResponse, description="Workspace detail")
    def post(self, workspace_id: str, *, auth_data: AuthData):
        assert auth_data.account_id is not None
        account_id = str(auth_data.account_id)
        try:
            with session_factory.create_session() as session:
                account = AccountService.get_account_by_id(account_id, session=session)
                if account is None:
                    raise RuntimeError("authenticated account_id has no Account row")
                TenantService.switch_tenant(account, workspace_id, session=session)
        except AccountNotLinkTenantError:
            raise NotFound("workspace not found")

        workspace = application_services().workspace_queries.get_for_account_with_roles(account_id, workspace_id)
        if workspace is None:
            raise NotFound("workspace not found")
        return _workspace_detail(workspace)


@openapi_ns.route("/workspaces/<string:workspace_id>/members")
class WorkspaceMembersApi(Resource):
    """List + invite members.

    GET is any-member. POST requires admin/owner — owner can never be
    assigned through invite (ownership transfer is console-only).
    """

    @auth_router.guard_workspace(scope=Scope.WORKSPACE_READ, allowed_token_types=frozenset({TokenType.OAUTH_ACCOUNT}))
    @returns(200, MemberListResponse, description="Member list")
    @accepts(query=MemberListQuery)
    def get(self, workspace_id: str, *, auth_data: AuthData, query: MemberListQuery):
        assert auth_data.account_id is not None
        members = application_services().workspace_member_queries.list_for_workspace(
            workspace_id,
            str(auth_data.account_id),
        )
        total = len(members)
        start = (query.page - 1) * query.limit
        page_items = members[start : start + query.limit]
        return MemberListResponse(
            page=query.page,
            limit=query.limit,
            total=total,
            has_more=query.page * query.limit < total,
            data=[_member_response(m) for m in page_items],
        )

    @auth_router.guard_workspace(
        scope=Scope.WORKSPACE_WRITE,
        allowed_token_types=frozenset({TokenType.OAUTH_ACCOUNT}),
        allowed_roles=frozenset({TenantAccountRole.OWNER, TenantAccountRole.ADMIN}),
        rbac=RBACRequirement(
            resource_type=RBACResourceScope.WORKSPACE,
            scene=RBACPermission.WORKSPACE_MEMBER_MANAGE,
            resource_required=False,
        ),
    )
    @returns(201, MemberInviteResponse, description="Member invited")
    @accepts(body=MemberInvitePayload)
    @with_session
    def post(self, session: Session, workspace_id: str, *, auth_data: AuthData, body: MemberInvitePayload):
        assert auth_data.account_id is not None
        inviter_id = str(auth_data.account_id)

        try:
            token = RegisterService.invite_new_member(
                tenant_id=workspace_id,
                email=body.email,
                language=None,
                role=body.role,
                inviter_id=inviter_id,
            )
        except AccountAlreadyInTenantError as exc:
            raise BadRequest(str(exc))
        except NoPermissionError as exc:
            raise Forbidden(str(exc))
        except SeatsLimitExceededError:
            raise BadRequest("licensed seats limit exceeded")
        except WorkspaceMembersLimitExceededError as exc:
            if dify_config.DEPLOYMENT_EDITION == DeploymentEdition.ENTERPRISE:
                raise MemberLicenseExceeded() from exc
            raise MemberLimitExceeded() from exc
        except AccountRegisterError as exc:
            raise BadRequest(str(exc))

        normalized_email = body.email.lower()
        member = AccountService.get_account_by_email_with_case_fallback(normalized_email, session=session)
        if member is None:
            # invite_new_member just created or fetched this account.
            raise RuntimeError("invited member missing from DB after invite")

        encoded_email = parse.quote(normalized_email)
        invite_url = f"{dify_config.CONSOLE_WEB_URL}/activate?email={encoded_email}&token={token}"
        return MemberInviteResponse(
            email=normalized_email,
            role=body.role,
            member_id=str(member.id),
            invite_url=invite_url,
            tenant_id=workspace_id,
        )


@openapi_ns.route("/workspaces/<string:workspace_id>/members/<string:member_id>")
class WorkspaceMemberApi(Resource):
    """Remove a member (DELETE) or change a member's role (PATCH).

    Self-removal and owner-removal are explicitly rejected by the service
    layer (CannotOperateSelfError, NoPermissionError) — both surface as
    400 per the spec, with the service's message preserved. Owner can never be
    assigned via PATCH (closed enum); admin cannot demote the standing owner.
    """

    @auth_router.guard_workspace(
        scope=Scope.WORKSPACE_WRITE,
        allowed_token_types=frozenset({TokenType.OAUTH_ACCOUNT}),
        allowed_roles=frozenset({TenantAccountRole.OWNER, TenantAccountRole.ADMIN}),
        rbac=RBACRequirement(
            resource_type=RBACResourceScope.WORKSPACE,
            scene=RBACPermission.WORKSPACE_MEMBER_MANAGE,
            resource_required=False,
        ),
    )
    @returns(200, MemberActionResponse, description="Member removed")
    def delete(self, workspace_id: str, member_id: str, *, auth_data: AuthData):
        assert auth_data.account_id is not None
        try:
            TenantService.remove_member_from_tenant(workspace_id, member_id, str(auth_data.account_id))
        except (CannotOperateSelfError, NoPermissionError) as exc:
            raise BadRequest(str(exc))
        except MemberNotInTenantError as exc:
            raise NotFound(str(exc))

        return MemberActionResponse()

    @auth_router.guard_workspace(
        scope=Scope.WORKSPACE_WRITE,
        allowed_token_types=frozenset({TokenType.OAUTH_ACCOUNT}),
        allowed_roles=frozenset({TenantAccountRole.OWNER, TenantAccountRole.ADMIN}),
        rbac=RBACRequirement(
            resource_type=RBACResourceScope.WORKSPACE,
            scene=RBACPermission.WORKSPACE_ROLE_MANAGE,
            resource_required=False,
        ),
    )
    @returns(200, MemberActionResponse, description="Role updated")
    @accepts(body=MemberRoleUpdatePayload)
    def patch(
        self,
        workspace_id: str,
        member_id: str,
        *,
        auth_data: AuthData,
        body: MemberRoleUpdatePayload,
    ):
        assert auth_data.account_id is not None
        try:
            TenantService.update_member_role(workspace_id, member_id, body.role, str(auth_data.account_id))
        except (CannotOperateSelfError, NoPermissionError, RoleAlreadyAssignedError) as exc:
            raise BadRequest(str(exc))
        except MemberNotInTenantError as exc:
            raise NotFound(str(exc))

        return MemberActionResponse()


def _workspace_summary(workspace: WorkspaceWithRoles) -> WorkspaceSummaryResponse:
    return WorkspaceSummaryResponse(
        id=workspace.id,
        name=workspace.name or "",
        roles=_role_responses(workspace.roles),
        status=workspace.status,
        current=workspace.current,
    )


def _workspace_detail(workspace: WorkspaceWithRoles) -> WorkspaceDetailResponse:
    return WorkspaceDetailResponse(
        id=workspace.id,
        name=workspace.name or "",
        roles=_role_responses(workspace.roles),
        status=workspace.status,
        current=workspace.current,
        created_at=workspace.created_at.isoformat(),
    )
