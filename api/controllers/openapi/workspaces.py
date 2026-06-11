"""User-scoped workspace reads and member management under /openapi/v1/workspaces.

Bearer-authed counterparts to the cookie-authed /console/api/workspaces
endpoints. Account bearers (dfoa_) see every tenant they're a member of.
External SSO bearers (dfoe_) have no account_id and so see an empty list —
that matches /openapi/v1/account.

Member-management endpoints use ``guard_workspace`` which enforces
workspace membership and optional role requirements via the auth pipeline.
"""

from __future__ import annotations

from itertools import starmap
from urllib import parse

from flask_restx import Resource
from werkzeug.exceptions import BadRequest, NotFound

from configs import dify_config
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
    WorkspaceSummaryResponse,
)
from controllers.openapi.auth.composition import auth_router
from controllers.openapi.auth.data import AuthData
from extensions.ext_database import db
from libs.oauth_bearer import Scope, TokenType
from models import Account, Tenant, TenantAccountJoin
from models.account import TenantAccountRole, TenantStatus
from services.account_service import AccountService, RegisterService, TenantService
from services.errors.account import (
    AccountAlreadyInTenantError,
    AccountNotLinkTenantError,
    AccountRegisterError,
    CannotOperateSelfError,
    MemberNotInTenantError,
    NoPermissionError,
    RoleAlreadyAssignedError,
)
from services.feature_service import FeatureService


def _member_response(account: Account) -> MemberResponse:
    return MemberResponse(
        id=str(account.id),
        name=account.name,
        email=account.email,
        role=account.role.value if account.role else "",
        status=account.status.value if account.status else "",
        avatar=account.avatar,
    )


def _load_tenant(workspace_id: str) -> Tenant:
    tenant = TenantService.get_tenant_by_id(db.session, workspace_id)
    if tenant is None or tenant.status != TenantStatus.NORMAL:
        raise NotFound("workspace not found")
    return tenant


def _load_account(account_id: object) -> Account:
    account = AccountService.get_account_by_id(db.session, str(account_id)) if account_id else None
    if account is None:
        raise RuntimeError("authenticated account_id has no Account row")
    return account


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
    @auth_router.guard(scope=Scope.WORKSPACE_READ, allowed_token_types=frozenset({TokenType.OAUTH_ACCOUNT}))
    @returns(200, WorkspaceListResponse, description="Workspace list")
    def get(self, *, auth_data: AuthData):
        rows = TenantService.get_workspaces_for_account(db.session, str(auth_data.account_id))

        return WorkspaceListResponse(workspaces=list(starmap(_workspace_summary, rows)))


@openapi_ns.route("/workspaces/<string:workspace_id>")
class WorkspaceByIdApi(Resource):
    @auth_router.guard(scope=Scope.WORKSPACE_READ, allowed_token_types=frozenset({TokenType.OAUTH_ACCOUNT}))
    @returns(200, WorkspaceDetailResponse, description="Workspace detail")
    def get(self, workspace_id: str, *, auth_data: AuthData):
        row = TenantService.find_workspace_for_account(db.session, str(auth_data.account_id), workspace_id)
        # 404 (not 403) on non-member so workspace IDs don't leak across tenants.
        if row is None:
            raise NotFound("workspace not found")

        tenant, membership = row
        return _workspace_detail(tenant, membership)


@openapi_ns.route("/workspaces/<string:workspace_id>/switch")
class WorkspaceSwitchApi(Resource):
    """Server-side switch — equivalent to the console's POST /workspaces/switch.

    CLI `difyctl use workspace <id>` calls this; it does NOT mutate
    ``hosts.yml`` on its own. Failure here must abort the local write so
    that ``hosts.yml`` never diverges from the server's ``current`` state.
    """

    @auth_router.guard_workspace(scope=Scope.WORKSPACE_READ, allowed_token_types=frozenset({TokenType.OAUTH_ACCOUNT}))
    @returns(200, WorkspaceDetailResponse, description="Workspace detail")
    def post(self, workspace_id: str, *, auth_data: AuthData):
        account = _load_account(auth_data.account_id)

        try:
            TenantService.switch_tenant(account, workspace_id)
        except AccountNotLinkTenantError:
            raise NotFound("workspace not found")

        row = TenantService.find_workspace_for_account(db.session, str(auth_data.account_id), workspace_id)
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

    @auth_router.guard_workspace(scope=Scope.WORKSPACE_READ, allowed_token_types=frozenset({TokenType.OAUTH_ACCOUNT}))
    @returns(200, MemberListResponse, description="Member list")
    @accepts(query=MemberListQuery)
    def get(self, workspace_id: str, *, auth_data: AuthData, query: MemberListQuery):
        tenant = _load_tenant(workspace_id)
        members = TenantService.get_tenant_members(tenant)
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
    )
    @returns(201, MemberInviteResponse, description="Member invited")
    @accepts(body=MemberInvitePayload)
    def post(self, workspace_id: str, *, auth_data: AuthData, body: MemberInvitePayload):
        inviter = _load_account(auth_data.account_id)
        tenant = _load_tenant(workspace_id)

        _check_member_invite_quota(str(tenant.id))

        try:
            token = RegisterService.invite_new_member(
                tenant=tenant,
                email=body.email,
                language=None,
                role=body.role,
                inviter=inviter,
            )
        except AccountAlreadyInTenantError as exc:
            raise BadRequest(str(exc))
        except NoPermissionError as exc:
            raise BadRequest(str(exc))
        except AccountRegisterError as exc:
            raise BadRequest(str(exc))

        normalized_email = body.email.lower()
        member = AccountService.get_account_by_email_with_case_fallback(normalized_email)
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
            tenant_id=str(tenant.id),
        )


@openapi_ns.route("/workspaces/<string:workspace_id>/members/<string:member_id>")
class WorkspaceMemberApi(Resource):
    """Remove a member.

    Self-removal and owner-removal are explicitly rejected by the service
    layer (CannotOperateSelfError, NoPermissionError) — both surface as
    400 per the spec, with the service's message preserved.
    """

    @auth_router.guard_workspace(
        scope=Scope.WORKSPACE_WRITE,
        allowed_token_types=frozenset({TokenType.OAUTH_ACCOUNT}),
        allowed_roles=frozenset({TenantAccountRole.OWNER, TenantAccountRole.ADMIN}),
    )
    @returns(200, MemberActionResponse, description="Member removed")
    def delete(self, workspace_id: str, member_id: str, *, auth_data: AuthData):
        operator = _load_account(auth_data.account_id)
        tenant = _load_tenant(workspace_id)
        member = AccountService.get_account_by_id(db.session, member_id)
        if member is None:
            raise NotFound("member not found")

        try:
            TenantService.remove_member_from_tenant(tenant, member, operator)
        except CannotOperateSelfError as exc:
            raise BadRequest(str(exc))
        except NoPermissionError as exc:
            raise BadRequest(str(exc))
        except MemberNotInTenantError as exc:
            raise NotFound(str(exc))

        return MemberActionResponse()


@openapi_ns.route("/workspaces/<string:workspace_id>/members/<string:member_id>/role")
class WorkspaceMemberRoleApi(Resource):
    """Change a member's role.

    Owner cannot be assigned here (closed enum). Admin cannot demote the
    standing owner (service NoPermissionError → 400, per spec).
    """

    @auth_router.guard_workspace(
        scope=Scope.WORKSPACE_WRITE,
        allowed_token_types=frozenset({TokenType.OAUTH_ACCOUNT}),
        allowed_roles=frozenset({TenantAccountRole.OWNER, TenantAccountRole.ADMIN}),
    )
    @returns(200, MemberActionResponse, description="Role updated")
    @accepts(body=MemberRoleUpdatePayload)
    def put(self, workspace_id: str, member_id: str, *, auth_data: AuthData, body: MemberRoleUpdatePayload):
        operator = _load_account(auth_data.account_id)
        tenant = _load_tenant(workspace_id)
        member = AccountService.get_account_by_id(db.session, member_id)
        if member is None:
            raise NotFound("member not found")

        try:
            TenantService.update_member_role(tenant, member, body.role, operator)
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
