"""User-scoped workspace reads and member management under /openapi/v1/workspaces.

Bearer-authed counterparts to the cookie-authed /console/api/workspaces
endpoints. Account bearers (dfoa_) see every tenant they're a member of.
External SSO bearers (dfoe_) have no account_id and so see an empty list —
that matches /openapi/v1/account.

Member-management endpoints are gated by both `accept_subjects` (SSO out)
and `require_workspace_role` (membership / role lookup against the path's
``workspace_id``).
"""

from __future__ import annotations

from itertools import starmap
from urllib import parse

from flask import jsonify, make_response, request
from flask_restx import Resource
from pydantic import BaseModel, ValidationError
from werkzeug.exceptions import BadRequest, Forbidden, NotFound

from configs import dify_config
from controllers.common.schema import query_params_from_model
from controllers.openapi import openapi_ns
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
from controllers.openapi.auth.role_gate import require_workspace_role
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


def _validate_body[M: BaseModel](model: type[M]) -> M:
    body = request.get_json(silent=True) or {}
    try:
        return model.model_validate(body)
    except ValidationError as exc:
        raise BadRequest(str(exc))


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


def _quota_error(*, code: str, message: str, hint: str) -> Forbidden:
    err = Forbidden(message)
    err.response = make_response(
        jsonify({"code": code, "message": message, "hint": hint}),
        403,
    )
    return err


def _check_member_invite_quota(tenant_id: str) -> None:
    features = FeatureService.get_features(tenant_id)

    if features.billing.enabled:
        members = features.members
        if 0 < members.limit <= members.size:
            raise _quota_error(
                code="members.limit_exceeded",
                message="Subscription member limit reached.",
                hint="Upgrade your plan to invite more members or remove an existing member first.",
            )

    if features.workspace_members.enabled:
        if not features.workspace_members.is_available(1):
            raise _quota_error(
                code="workspace_members.license_exceeded",
                message="Workspace member license capacity reached.",
                hint="Contact your workspace administrator to expand the license seat count.",
            )


@openapi_ns.route("/workspaces")
class WorkspacesApi(Resource):
    @openapi_ns.response(200, "Workspace list", openapi_ns.models[WorkspaceListResponse.__name__])
    @auth_router.guard(scope=Scope.WORKSPACE_READ, allowed_token_types=frozenset({TokenType.OAUTH_ACCOUNT}))
    def get(self, *, auth_data: AuthData):
        rows = TenantService.get_workspaces_for_account(db.session, str(auth_data.account_id))

        return WorkspaceListResponse(workspaces=list(starmap(_workspace_summary, rows))).model_dump(mode="json"), 200


@openapi_ns.route("/workspaces/<string:workspace_id>")
class WorkspaceByIdApi(Resource):
    @openapi_ns.response(200, "Workspace detail", openapi_ns.models[WorkspaceDetailResponse.__name__])
    @auth_router.guard(scope=Scope.WORKSPACE_READ, allowed_token_types=frozenset({TokenType.OAUTH_ACCOUNT}))
    def get(self, workspace_id: str, *, auth_data: AuthData):
        row = TenantService.find_workspace_for_account(db.session, str(auth_data.account_id), workspace_id)
        # 404 (not 403) on non-member so workspace IDs don't leak across tenants.
        if row is None:
            raise NotFound("workspace not found")

        tenant, membership = row
        return _workspace_detail(tenant, membership).model_dump(mode="json"), 200


@openapi_ns.route("/workspaces/<string:workspace_id>/switch")
class WorkspaceSwitchApi(Resource):
    """Server-side switch — equivalent to the console's POST /workspaces/switch.

    CLI `difyctl use workspace <id>` calls this; it does NOT mutate
    ``hosts.yml`` on its own. Failure here must abort the local write so
    that ``hosts.yml`` never diverges from the server's ``current`` state.
    """

    @openapi_ns.response(200, "Workspace detail", openapi_ns.models[WorkspaceDetailResponse.__name__])
    @auth_router.guard(scope=Scope.WORKSPACE_READ, allowed_token_types=frozenset({TokenType.OAUTH_ACCOUNT}))
    @require_workspace_role()
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
        return _workspace_detail(tenant, membership).model_dump(mode="json"), 200


@openapi_ns.route("/workspaces/<string:workspace_id>/members")
class WorkspaceMembersApi(Resource):
    """List + invite members.

    GET is any-member. POST requires admin/owner — owner can never be
    assigned through invite (ownership transfer is console-only).
    """

    @openapi_ns.doc(params=query_params_from_model(MemberListQuery))
    @openapi_ns.response(200, "Member list", openapi_ns.models[MemberListResponse.__name__])
    @auth_router.guard(scope=Scope.WORKSPACE_READ, allowed_token_types=frozenset({TokenType.OAUTH_ACCOUNT}))
    @require_workspace_role()
    def get(self, workspace_id: str, *, auth_data: AuthData):
        try:
            query = MemberListQuery.model_validate(request.args.to_dict(flat=True))
        except ValidationError as exc:
            raise BadRequest(str(exc))

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
        ).model_dump(mode="json"), 200

    @openapi_ns.expect(openapi_ns.models[MemberInvitePayload.__name__])
    @openapi_ns.response(201, "Member invited", openapi_ns.models[MemberInviteResponse.__name__])
    @auth_router.guard(scope=Scope.WORKSPACE_WRITE, allowed_token_types=frozenset({TokenType.OAUTH_ACCOUNT}))
    @require_workspace_role(TenantAccountRole.OWNER, TenantAccountRole.ADMIN)
    def post(self, workspace_id: str, *, auth_data: AuthData):
        payload = _validate_body(MemberInvitePayload)
        inviter = _load_account(auth_data.account_id)
        tenant = _load_tenant(workspace_id)

        _check_member_invite_quota(str(tenant.id))

        try:
            token = RegisterService.invite_new_member(
                tenant=tenant,
                email=payload.email,
                language=None,
                role=payload.role,
                inviter=inviter,
            )
        except AccountAlreadyInTenantError as exc:
            raise BadRequest(str(exc))
        except NoPermissionError as exc:
            raise BadRequest(str(exc))
        except AccountRegisterError as exc:
            raise BadRequest(str(exc))

        normalized_email = payload.email.lower()
        member = AccountService.get_account_by_email_with_case_fallback(normalized_email)
        if member is None:
            # invite_new_member just created or fetched this account.
            raise RuntimeError("invited member missing from DB after invite")

        encoded_email = parse.quote(normalized_email)
        invite_url = f"{dify_config.CONSOLE_WEB_URL}/activate?email={encoded_email}&token={token}"
        return MemberInviteResponse(
            email=normalized_email,
            role=payload.role,
            member_id=str(member.id),
            invite_url=invite_url,
            tenant_id=str(tenant.id),
        ).model_dump(mode="json"), 201


@openapi_ns.route("/workspaces/<string:workspace_id>/members/<string:member_id>")
class WorkspaceMemberApi(Resource):
    """Remove a member.

    Self-removal and owner-removal are explicitly rejected by the service
    layer (CannotOperateSelfError, NoPermissionError) — both surface as
    400 per the spec, with the service's message preserved.
    """

    @openapi_ns.response(200, "Member removed", openapi_ns.models[MemberActionResponse.__name__])
    @auth_router.guard(scope=Scope.WORKSPACE_WRITE, allowed_token_types=frozenset({TokenType.OAUTH_ACCOUNT}))
    @require_workspace_role(TenantAccountRole.OWNER, TenantAccountRole.ADMIN)
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

        return MemberActionResponse().model_dump(mode="json"), 200


@openapi_ns.route("/workspaces/<string:workspace_id>/members/<string:member_id>/role")
class WorkspaceMemberRoleApi(Resource):
    """Change a member's role.

    Owner cannot be assigned here (closed enum). Admin cannot demote the
    standing owner (service NoPermissionError → 400, per spec).
    """

    @openapi_ns.expect(openapi_ns.models[MemberRoleUpdatePayload.__name__])
    @openapi_ns.response(200, "Role updated", openapi_ns.models[MemberActionResponse.__name__])
    @auth_router.guard(scope=Scope.WORKSPACE_WRITE, allowed_token_types=frozenset({TokenType.OAUTH_ACCOUNT}))
    @require_workspace_role(TenantAccountRole.OWNER, TenantAccountRole.ADMIN)
    def put(self, workspace_id: str, member_id: str, *, auth_data: AuthData):
        payload = _validate_body(MemberRoleUpdatePayload)
        operator = _load_account(auth_data.account_id)
        tenant = _load_tenant(workspace_id)
        member = AccountService.get_account_by_id(db.session, member_id)
        if member is None:
            raise NotFound("member not found")

        try:
            TenantService.update_member_role(tenant, member, payload.role, operator)
        except CannotOperateSelfError as exc:
            raise BadRequest(str(exc))
        except NoPermissionError as exc:
            raise BadRequest(str(exc))
        except MemberNotInTenantError as exc:
            raise NotFound(str(exc))
        except RoleAlreadyAssignedError as exc:
            raise BadRequest(str(exc))

        return MemberActionResponse().model_dump(mode="json"), 200


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
