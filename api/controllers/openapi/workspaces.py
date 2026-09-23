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

from urllib import parse
from uuid import UUID

from flask_restx import Resource
from werkzeug.exceptions import BadRequest, NotFound

from configs import dify_config
from constants.oauth_bearer import Scope
from controllers.common.rbac import RBACCheck, RBACPermission, Workspace
from controllers.openapi import openapi_ns
from controllers.openapi._contract import Example, Kind, endpoint
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
    CheckWorkspaceInvitationQuota,
    CheckWorkspaceMember,
    CheckWorkspaceRole,
)
from controllers.openapi.auth.subjects import AccountSubject
from enums.account import TenantAccountRole
from extensions.ext_application_services import application_services
from services.account_errors import AccountNotFoundError, AccountRegisterError, SeatsLimitExceededError
from services.errors.base import NoPermissionError
from services.errors.workspace import (
    AccountAlreadyInTenantError,
    CannotOperateSelfError,
    InvalidWorkspaceMemberRoleError,
    MemberNotInTenantError,
    RoleAlreadyAssignedError,
    WorkspaceNotLinkedError,
)
from services.workspace.contracts import WorkspaceInvitation, WorkspaceMemberRecord, WorkspaceSnapshot


def _member_response(account: WorkspaceMemberRecord) -> MemberResponse:
    return MemberResponse(
        id=str(account.id),
        name=account.name,
        email=account.email,
        role=account.legacy_role,
        status=account.status,
        avatar=account.avatar,
    )


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
        rows = application_services().workspaces.management.list_memberships(str(ctx.subject.account_id))
        return WorkspaceListResponse.page_of([_workspace_summary(row) for row in rows], query=query)


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
        row = application_services().workspaces.management.find_membership(str(ctx.subject.account_id), workspace_id)
        if row is None:
            raise NotFound("workspace not found")

        return _workspace_detail(row)


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
            workspace = application_services().workspaces.management.switch_membership(
                str(ctx.subject.account_id), workspace_id
            )
        except WorkspaceNotLinkedError:
            raise NotFound("workspace not found") from None
        return _workspace_detail(workspace)


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
        result = application_services().workspaces.member_queries.list_page(
            ctx.request_context, page=query.page, limit=query.limit
        )
        return MemberListResponse.build(
            page=query.page,
            limit=query.limit,
            total=result.total,
            items=[_member_response(m) for m in result.members],
        )

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
            CheckWorkspaceInvitationQuota(),
        ),
        body=MemberInvitePayload,
        returns=(201, MemberInviteResponse, "Member invited"),
    )
    def post(self, ctx: Context, workspace_id: str, *, body: MemberInvitePayload):
        try:
            invitation = application_services().workspaces.invitations.invite(
                ctx.request_context,
                email=body.email,
                language=None,
                role=body.role,
            )
        except AccountAlreadyInTenantError as exc:
            raise BadRequest(str(exc))
        except InvalidWorkspaceMemberRoleError as exc:
            raise BadRequest(str(exc)) from exc
        except NoPermissionError as exc:
            raise BadRequest(str(exc))
        except SeatsLimitExceededError:
            raise BadRequest("licensed seats limit exceeded")
        except AccountRegisterError as exc:
            raise BadRequest(str(exc))

        return _invitation_response(invitation)


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
        member_id = _parse_member_id(member_id)
        try:
            application_services().workspaces.members.remove(workspace_id, member_id, str(ctx.subject.account_id))
        except AccountNotFoundError:
            raise NotFound("member not found") from None
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
        member_id = _parse_member_id(member_id)
        try:
            application_services().workspaces.members.update_role(
                workspace_id, member_id, body.role, str(ctx.subject.account_id)
            )
        except AccountNotFoundError:
            raise NotFound("member not found") from None
        except CannotOperateSelfError as exc:
            raise BadRequest(str(exc))
        except NoPermissionError as exc:
            raise BadRequest(str(exc))
        except MemberNotInTenantError as exc:
            raise NotFound(str(exc))
        except RoleAlreadyAssignedError as exc:
            raise BadRequest(str(exc))
        except InvalidWorkspaceMemberRoleError as exc:
            raise BadRequest(str(exc)) from exc

        return MemberActionResponse()


def _parse_member_id(member_id: str) -> str:
    # Permission comparisons must use the same identity as UUID database lookups.
    try:
        return str(UUID(member_id))
    except ValueError:
        raise NotFound("member not found") from None


def _invitation_response(invitation: WorkspaceInvitation) -> MemberInviteResponse:
    encoded_email = parse.quote(invitation.email)
    return MemberInviteResponse(
        email=invitation.email,
        role=invitation.role,
        member_id=invitation.account_id,
        invite_url=f"{dify_config.CONSOLE_WEB_URL}/activate?email={encoded_email}&token={invitation.token}",
        tenant_id=invitation.workspace_id,
    )


def _workspace_summary(tenant: WorkspaceSnapshot) -> WorkspaceSummaryResponse:
    return WorkspaceSummaryResponse(
        id=str(tenant.id),
        name=tenant.name,
        role=tenant.role or "",
        status=tenant.status,
        current=tenant.current,
    )


def _workspace_detail(tenant: WorkspaceSnapshot) -> WorkspaceDetailResponse:
    return WorkspaceDetailResponse(
        id=str(tenant.id),
        name=tenant.name,
        role=tenant.role or "",
        status=tenant.status,
        current=tenant.current,
        created_at=tenant.created_at.isoformat() if tenant.created_at else None,
    )
