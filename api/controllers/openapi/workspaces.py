"""User-scoped workspace reads and member management under /openapi/v1/workspaces.

Bearer-authed counterparts to the cookie-authed /console/api/workspaces
endpoints. Account bearers (dfoa_) see every tenant they're a member of.
External SSO bearers (dfoe_) have no account_id and so see an empty list —
that matches /openapi/v1/account.

Member management declares both authorization arms; ``RBAC_ENABLED`` picks one.
``GET /workspaces/<workspace_id>`` deliberately declares neither: it admits any
account bearer and lets the view's own membership-scoped lookup answer 404.
"""

from __future__ import annotations

from itertools import starmap
from urllib import parse

from flask_restx import Resource
from werkzeug.exceptions import BadRequest, NotFound

from configs import dify_config
from constants.oauth_bearer import Scope
from controllers.common.rbac import RBACCheck, RBACPermission, Workspace
from controllers.openapi import openapi_ns
from controllers.openapi._contract import Example, Kind, endpoint
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
    WorkspaceListQuery,
    WorkspaceListResponse,
    WorkspaceSummaryResponse,
)
from controllers.openapi.auth.context import Context
from controllers.openapi.auth.requirements import (
    CheckRBACPermission,
    CheckScope,
    CheckSubject,
    CheckWorkspaceMember,
    CheckWorkspaceRole,
)
from controllers.openapi.auth.subjects import AccountSubject
from enums import DeploymentEdition
from models import Account, Tenant, TenantAccountJoin
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
)
from services.feature_service import FeatureService


def _member_response(account: Account) -> MemberResponse:
    return MemberResponse(
        id=account.id,
        name=account.name,
        email=account.email,
        role=account.role.value if account.role else "",
        status=account.status.value if account.status else "",
        avatar=account.avatar,
    )


def _check_member_invite_quota(tenant_id: str) -> None:
    features = FeatureService.get_features(tenant_id)

    if dify_config.DEPLOYMENT_EDITION == DeploymentEdition.CLOUD:
        members = features.members
        if 0 < members.limit <= members.size:
            raise MemberLimitExceeded()

    if features.workspace_members.enabled and not features.workspace_members.is_available(1):
        raise MemberLicenseExceeded()


@openapi_ns.route("/workspaces")
class WorkspacesApi(Resource):
    @endpoint(
        op="workspace.list",
        kind=Kind.LIST,
        summary="List workspaces of the current account",
        examples=(Example(title="List my workspaces, first page", input={"page": 1, "limit": 20}),),
        requirements=(CheckSubject(allowed=(AccountSubject,)), CheckScope(Scope.WORKSPACE_READ)),
        query=WorkspaceListQuery,
        returns=(200, WorkspaceListResponse, "Workspace list"),
    )
    def get(self, ctx: Context, *, query: WorkspaceListQuery):
        rows = TenantService.get_workspaces_for_account(str(ctx.subject.account_id), session=ctx.session)
        return WorkspaceListResponse.page_of(list(starmap(_workspace_summary, rows)), query=query)


@openapi_ns.route("/workspaces/<string:workspace_id>")
class WorkspaceByIdApi(Resource):
    @endpoint(
        op="workspace.get",
        kind=Kind.OBJECT,
        summary="Workspace detail",
        examples=(
            Example(title="Show the pinned workspace", input={}),
            Example(title="Show another workspace by id", input={"workspace_id": "<workspace_id>"}),
        ),
        requirements=(CheckSubject(allowed=(AccountSubject,)), CheckScope(Scope.WORKSPACE_READ)),
        returns=(200, WorkspaceDetailResponse, "Workspace detail"),
    )
    def get(self, ctx: Context, workspace_id: str):
        row = TenantService.find_workspace_for_account(str(ctx.subject.account_id), workspace_id, session=ctx.session)
        if row is None:
            raise NotFound("workspace not found")

        tenant, membership = row
        return _workspace_detail(tenant, membership)


@openapi_ns.route("/workspaces/<string:workspace_id>:switch")
class WorkspaceSwitchApi(Resource):
    """Server-side switch — equivalent to the console's POST /workspaces/switch.

    CLI `difyctl use workspace <id>` calls this; it does NOT mutate
    ``hosts.yml`` on its own. Failure here must abort the local write so
    that ``hosts.yml`` never diverges from the server's ``current`` state.
    """

    @endpoint(
        op="workspace.switch",
        kind=Kind.OBJECT,
        summary="Server-side current workspace switch (shared with the web console)",
        examples=(Example(title="Make a workspace current on the server", input={"workspace_id": "<workspace_id>"}),),
        internal=True,
        requirements=(
            CheckSubject(allowed=(AccountSubject,)),
            CheckScope(Scope.WORKSPACE_READ),
            CheckWorkspaceMember(),
        ),
        returns=(200, WorkspaceDetailResponse, "Workspace detail"),
    )
    def post(self, ctx: Context, workspace_id: str):
        try:
            TenantService.switch_tenant(ctx.account, workspace_id, session=ctx.session)
        except AccountNotLinkTenantError:
            raise NotFound("workspace not found")

        row = TenantService.find_workspace_for_account(str(ctx.subject.account_id), workspace_id, session=ctx.session)
        if row is None:
            raise NotFound("workspace not found")
        tenant, membership = row
        return _workspace_detail(tenant, membership)


@openapi_ns.route("/workspaces/<string:workspace_id>/members")
class WorkspaceMembersApi(Resource):
    """List + invite members.

    GET is any-member. POST requires admin/owner — owner can never be
    assigned through invite (ownership transfer is console-only).
    """

    @endpoint(
        op="workspace.members.list",
        kind=Kind.LIST,
        summary="List workspace members",
        examples=(Example(title="List members of the pinned workspace, first page", input={"page": 1, "limit": 20}),),
        requirements=(
            CheckSubject(allowed=(AccountSubject,)),
            CheckScope(Scope.WORKSPACE_READ),
            CheckWorkspaceMember(),
        ),
        query=MemberListQuery,
        returns=(200, MemberListResponse, "Member list"),
    )
    def get(self, ctx: Context, workspace_id: str, *, query: MemberListQuery):
        members = TenantService.get_tenant_members(ctx.workspace, session=ctx.session)
        return MemberListResponse.page_of([_member_response(m) for m in members], query=query)

    @endpoint(
        op="workspace.members.invite",
        kind=Kind.OBJECT,
        summary="Invite a member by email",
        examples=(
            Example(title="Invite a member as a normal user", input={"email": "ada@example.com", "role": "normal"}),
            Example(title="Invite a member as an admin", input={"email": "grace@example.com", "role": "admin"}),
        ),
        requirements=(
            CheckSubject(allowed=(AccountSubject,)),
            CheckScope(Scope.WORKSPACE_WRITE),
            CheckWorkspaceMember(),
            CheckRBACPermission(RBACCheck(RBACPermission.WORKSPACE_MEMBER_MANAGE, Workspace())),
            CheckWorkspaceRole(frozenset({TenantAccountRole.OWNER, TenantAccountRole.ADMIN})),
        ),
        body=MemberInvitePayload,
        returns=(201, MemberInviteResponse, "Member invited"),
    )
    def post(self, ctx: Context, workspace_id: str, *, body: MemberInvitePayload):
        tenant = ctx.workspace

        _check_member_invite_quota(tenant.id)

        try:
            token = RegisterService.invite_new_member(
                tenant=tenant,
                email=body.email,
                language=None,
                role=body.role,
                inviter=ctx.account,
                session=ctx.session,
            )
        except AccountAlreadyInTenantError as exc:
            raise BadRequest(str(exc))
        except NoPermissionError as exc:
            raise BadRequest(str(exc))
        except SeatsLimitExceededError:
            raise BadRequest("licensed seats limit exceeded")
        except AccountRegisterError as exc:
            raise BadRequest(str(exc))

        normalized_email = body.email.lower()
        member = AccountService.get_account_by_email_with_case_fallback(normalized_email, session=ctx.session)
        if member is None:
            raise RuntimeError("invited member missing from DB after invite")

        encoded_email = parse.quote(normalized_email)
        invite_url = f"{dify_config.CONSOLE_WEB_URL}/activate?email={encoded_email}&token={token}"
        return MemberInviteResponse(
            email=normalized_email,
            role=body.role,
            member_id=member.id,
            invite_url=invite_url,
            tenant_id=tenant.id,
        )


@openapi_ns.route("/workspaces/<string:workspace_id>/members/<string:member_id>")
class WorkspaceMemberApi(Resource):
    """Remove a member (DELETE) or change a member's role (PATCH).

    Self-removal and owner-removal are explicitly rejected by the service
    layer (CannotOperateSelfError, NoPermissionError) — both surface as
    400 per the spec, with the service's message preserved. Owner can never be
    assigned via PATCH (closed enum); admin cannot demote the standing owner.
    """

    @endpoint(
        op="workspace.members.remove",
        kind=Kind.OBJECT,
        summary="Remove a member",
        examples=(Example(title="Remove a member by account id", input={"member_id": "<member_id>"}),),
        requirements=(
            CheckSubject(allowed=(AccountSubject,)),
            CheckScope(Scope.WORKSPACE_WRITE),
            CheckWorkspaceMember(),
            CheckRBACPermission(RBACCheck(RBACPermission.WORKSPACE_MEMBER_MANAGE, Workspace())),
            CheckWorkspaceRole(frozenset({TenantAccountRole.OWNER, TenantAccountRole.ADMIN})),
        ),
        returns=(200, MemberActionResponse, "Member removed"),
    )
    def delete(self, ctx: Context, workspace_id: str, member_id: str):
        member = AccountService.get_account_by_id(member_id, session=ctx.session)
        if member is None:
            raise NotFound("member not found")

        try:
            TenantService.remove_member_from_tenant(ctx.workspace, member, ctx.account, session=ctx.session)
        except CannotOperateSelfError as exc:
            raise BadRequest(str(exc))
        except NoPermissionError as exc:
            raise BadRequest(str(exc))
        except MemberNotInTenantError as exc:
            raise NotFound(str(exc))

        return MemberActionResponse()

    @endpoint(
        op="workspace.members.set_role",
        kind=Kind.OBJECT,
        summary="Change a member's role",
        examples=(
            Example(title="Promote a member to admin", input={"member_id": "<member_id>", "role": "admin"}),
            Example(title="Demote an admin to a normal member", input={"member_id": "<member_id>", "role": "normal"}),
        ),
        requirements=(
            CheckSubject(allowed=(AccountSubject,)),
            CheckScope(Scope.WORKSPACE_WRITE),
            CheckWorkspaceMember(),
            CheckRBACPermission(RBACCheck(RBACPermission.WORKSPACE_ROLE_MANAGE, Workspace())),
            CheckWorkspaceRole(frozenset({TenantAccountRole.OWNER, TenantAccountRole.ADMIN})),
        ),
        body=MemberRoleUpdatePayload,
        returns=(200, MemberActionResponse, "Role updated"),
    )
    def patch(self, ctx: Context, workspace_id: str, member_id: str, *, body: MemberRoleUpdatePayload):
        member = AccountService.get_account_by_id(member_id, session=ctx.session)
        if member is None:
            raise NotFound("member not found")

        try:
            TenantService.update_member_role(ctx.workspace, member, body.role, ctx.account, session=ctx.session)
        except CannotOperateSelfError as exc:
            raise BadRequest(str(exc))
        except NoPermissionError as exc:
            raise BadRequest(str(exc))
        except MemberNotInTenantError as exc:
            raise NotFound(str(exc))
        except RoleAlreadyAssignedError as exc:
            raise BadRequest(str(exc))

        return MemberActionResponse()


def _workspace_summary(tenant: Tenant, membership: TenantAccountJoin) -> WorkspaceSummaryResponse:
    return WorkspaceSummaryResponse(
        id=tenant.id,
        name=tenant.name,
        role=getattr(membership, "role", ""),
        status=tenant.status,
        current=getattr(membership, "current", False),
    )


def _workspace_detail(tenant: Tenant, membership: TenantAccountJoin) -> WorkspaceDetailResponse:
    return WorkspaceDetailResponse(
        id=tenant.id,
        name=tenant.name,
        role=getattr(membership, "role", ""),
        status=tenant.status,
        current=getattr(membership, "current", False),
        created_at=tenant.created_at.isoformat() if tenant.created_at else None,
    )
