"""User-scoped workspace reads and member management under /openapi/v1/workspaces.

Bearer-authed counterparts to the cookie-authed /console/api/workspaces
endpoints. Account bearers (dfoa_) see every tenant they're a member of.
External SSO bearers (dfoe_) have no account_id and so see an empty list —
that matches /openapi/v1/account.

Member-management endpoints declare ``CheckWorkspaceMember`` and, where
the console gates on role, a ``CheckWorkspaceRole``. That floor names no superseding
scene: nothing in the RBAC scene set covers member management on this surface,
so it stands whether or not RBAC is enabled.
``GET /workspaces/<workspace_id>`` deliberately declares neither: it admits any
account bearer and lets the view's own membership-scoped lookup answer 404.
"""

from __future__ import annotations

from itertools import starmap
from typing import cast
from urllib import parse

from flask_restx import Resource
from werkzeug.exceptions import BadRequest, NotFound

from configs import dify_config
from controllers.openapi import openapi_ns
from controllers.openapi._contract import endpoint
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
    WorkspaceSummaryResponse,
)
from controllers.openapi.auth.context import Context
from controllers.openapi.auth.loaders import load_caller, load_workspace
from controllers.openapi.auth.requirements import (
    CheckScope,
    CheckSubject,
    CheckWorkspaceMember,
    CheckWorkspaceRole,
)
from controllers.openapi.auth.subjects import AccountSubject
from libs.oauth_bearer import Scope
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

_ACCOUNT_SUBJECT = CheckSubject(allowed=(AccountSubject,))

_WORKSPACE_READ = (_ACCOUNT_SUBJECT, CheckScope(Scope.WORKSPACE_READ))
_WORKSPACE_MEMBER_READ = (*_WORKSPACE_READ, CheckWorkspaceMember())
_WORKSPACE_MEMBER_ADMIN = (
    _ACCOUNT_SUBJECT,
    CheckScope(Scope.WORKSPACE_WRITE),
    CheckWorkspaceMember(),
    CheckWorkspaceRole(frozenset({TenantAccountRole.OWNER, TenantAccountRole.ADMIN})),
)


def _member_response(account: Account) -> MemberResponse:
    return MemberResponse(
        id=str(account.id),
        name=account.name,
        email=account.email,
        role=account.role.value if account.role else "",
        status=account.status.value if account.status else "",
        avatar=account.avatar,
    )


def _check_member_invite_quota(tenant_id: str) -> None:
    features = FeatureService.get_features(tenant_id)

    if features.billing.enabled:
        members = features.members
        if 0 < members.limit <= members.size:
            raise MemberLimitExceeded()

    if features.workspace_members.enabled and not features.workspace_members.is_available(1):
        raise MemberLicenseExceeded()


@openapi_ns.route("/workspaces")
class WorkspacesApi(Resource):
    @endpoint(requirements=_WORKSPACE_READ, returns=(200, WorkspaceListResponse, "Workspace list"), write=False)
    def get(self, ctx: Context):
        rows = TenantService.get_workspaces_for_account(str(ctx.subject.account_id), session=ctx.session)

        return WorkspaceListResponse(workspaces=list(starmap(_workspace_summary, rows)))


@openapi_ns.route("/workspaces/<string:workspace_id>")
class WorkspaceByIdApi(Resource):
    @endpoint(requirements=_WORKSPACE_READ, returns=(200, WorkspaceDetailResponse, "Workspace detail"), write=False)
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

    @endpoint(requirements=_WORKSPACE_MEMBER_READ, returns=(200, WorkspaceDetailResponse, "Workspace detail"))
    def post(self, ctx: Context, workspace_id: str):
        try:
            TenantService.switch_tenant(cast(Account, load_caller(ctx)), workspace_id, session=ctx.session)
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
        requirements=_WORKSPACE_MEMBER_READ,
        query=MemberListQuery,
        returns=(200, MemberListResponse, "Member list"),
        write=False,
    )
    def get(self, ctx: Context, workspace_id: str, *, query: MemberListQuery):
        members = TenantService.get_tenant_members(load_workspace(ctx), session=ctx.session)
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

    @endpoint(
        requirements=_WORKSPACE_MEMBER_ADMIN,
        body=MemberInvitePayload,
        returns=(201, MemberInviteResponse, "Member invited"),
    )
    def post(self, ctx: Context, workspace_id: str, *, body: MemberInvitePayload):
        tenant = load_workspace(ctx)

        _check_member_invite_quota(str(tenant.id))

        try:
            token = RegisterService.invite_new_member(
                tenant=tenant,
                email=body.email,
                language=None,
                role=body.role,
                inviter=cast(Account, load_caller(ctx)),
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
            member_id=str(member.id),
            invite_url=invite_url,
            tenant_id=str(tenant.id),
        )


@openapi_ns.route("/workspaces/<string:workspace_id>/members/<string:member_id>")
class WorkspaceMemberApi(Resource):
    """Remove a member (DELETE) or change a member's role (PATCH).

    Self-removal and owner-removal are explicitly rejected by the service
    layer (CannotOperateSelfError, NoPermissionError) — both surface as
    400 per the spec, with the service's message preserved. Owner can never be
    assigned via PATCH (closed enum); admin cannot demote the standing owner.
    """

    @endpoint(requirements=_WORKSPACE_MEMBER_ADMIN, returns=(200, MemberActionResponse, "Member removed"))
    def delete(self, ctx: Context, workspace_id: str, member_id: str):
        member = AccountService.get_account_by_id(member_id, session=ctx.session)
        if member is None:
            raise NotFound("member not found")

        try:
            TenantService.remove_member_from_tenant(
                load_workspace(ctx), member, cast(Account, load_caller(ctx)), session=ctx.session
            )
        except CannotOperateSelfError as exc:
            raise BadRequest(str(exc))
        except NoPermissionError as exc:
            raise BadRequest(str(exc))
        except MemberNotInTenantError as exc:
            raise NotFound(str(exc))

        return MemberActionResponse()

    @endpoint(
        requirements=_WORKSPACE_MEMBER_ADMIN,
        body=MemberRoleUpdatePayload,
        returns=(200, MemberActionResponse, "Role updated"),
    )
    def patch(self, ctx: Context, workspace_id: str, member_id: str, *, body: MemberRoleUpdatePayload):
        member = AccountService.get_account_by_id(member_id, session=ctx.session)
        if member is None:
            raise NotFound("member not found")

        try:
            TenantService.update_member_role(
                load_workspace(ctx), member, body.role, cast(Account, load_caller(ctx)), session=ctx.session
            )
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
        id=str(tenant.id),
        name=tenant.name,
        role=getattr(membership, "role", ""),
        status=tenant.status,
        current=getattr(membership, "current", False),
    )


def _workspace_detail(tenant: Tenant, membership: TenantAccountJoin) -> WorkspaceDetailResponse:
    return WorkspaceDetailResponse(
        id=str(tenant.id),
        name=tenant.name,
        role=getattr(membership, "role", ""),
        status=tenant.status,
        current=getattr(membership, "current", False),
        created_at=tenant.created_at.isoformat() if tenant.created_at else None,
    )
