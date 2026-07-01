from urllib import parse
from uuid import UUID

from flask import abort, request
from flask_restx import Resource
from pydantic import BaseModel, Field, TypeAdapter
from sqlalchemy import func, select

import services
from configs import dify_config
from controllers.common.fields import SimpleResultDataResponse, SimpleResultResponse, VerificationTokenResponse
from controllers.common.schema import register_enum_models, register_response_schema_models, register_schema_models
from controllers.console import console_ns
from controllers.console.auth.error import (
    CannotTransferOwnerToSelfError,
    EmailCodeError,
    InvalidEmailError,
    InvalidTokenError,
    MemberNotInTenantError,
    NotOwnerError,
    OwnerTransferLimitError,
)
from controllers.console.error import EmailSendIpLimitError, WorkspaceMembersLimitExceeded
from controllers.console.wraps import (
    account_initialization_required,
    is_allow_transfer_owner,
    setup_required,
    with_current_user,
)
from extensions.ext_database import db
from extensions.ext_redis import redis_client
from fields.base import ResponseModel
from fields.member_fields import AccountWithRole, AccountWithRoleList
from libs.helper import extract_remote_ip
from libs.login import current_account_with_tenant, login_required
from models.account import Account, TenantAccountJoin, TenantAccountRole
from services.account_service import AccountService, RegisterService, TenantService
from services.enterprise import rbac_service as enterprise_rbac_service
from services.errors.account import AccountAlreadyInTenantError
from services.feature_service import FeatureService


class MemberInvitePayload(BaseModel):
    emails: list[str] = Field(default_factory=list)
    role: str
    language: str | None = None


class MemberRoleUpdatePayload(BaseModel):
    role: str


class OwnerTransferEmailPayload(BaseModel):
    language: str | None = None


class OwnerTransferCheckPayload(BaseModel):
    code: str
    token: str


class OwnerTransferPayload(BaseModel):
    token: str


class MemberInviteResultResponse(ResponseModel):
    status: str
    email: str
    url: str | None = None
    message: str | None = None


class MemberInviteResponse(ResponseModel):
    result: str
    invitation_results: list[MemberInviteResultResponse]
    tenant_id: str


class MemberActionTenantResponse(ResponseModel):
    result: str
    tenant_id: str


register_enum_models(console_ns, TenantAccountRole)
register_schema_models(
    console_ns,
    MemberInvitePayload,
    MemberRoleUpdatePayload,
    OwnerTransferEmailPayload,
    OwnerTransferCheckPayload,
    OwnerTransferPayload,
)
register_response_schema_models(
    console_ns,
    AccountWithRole,
    AccountWithRoleList,
    SimpleResultDataResponse,
    SimpleResultResponse,
    VerificationTokenResponse,
    MemberInviteResponse,
    MemberActionTenantResponse,
)


def _is_role_enabled(role: TenantAccountRole | str, tenant_id: str) -> bool:
    if role != TenantAccountRole.DATASET_OPERATOR:
        return True
    return FeatureService.get_features(tenant_id=tenant_id, exclude_vector_space=True).dataset_operator_enabled


def _serialize_member_roles(
    current_role: str | None, member_roles: list[enterprise_rbac_service.RBACRole]
) -> list[dict[str, str]]:
    if dify_config.RBAC_ENABLED:
        return [{"id": role.id, "name": role.name} for role in member_roles]
    else:
        if current_role:
            return [{"id": current_role, "name": current_role}]
        return []


def _normalize_enum_value(value: object) -> str:
    normalized = getattr(value, "value", value)
    return str(normalized) if normalized is not None else ""


def _normalize_invitee_emails(emails: list[str]) -> list[str]:
    return list(dict.fromkeys(email.lower() for email in emails))


def _count_new_member_invites(tenant_id: str, emails: list[str]) -> int:
    new_member_count = 0
    for email in emails:
        account = AccountService.get_account_by_email_with_case_fallback(db.session, email)
        if not account:
            new_member_count += 1
            continue

        exists = db.session.scalar(
            select(TenantAccountJoin.id)
            .where(TenantAccountJoin.tenant_id == tenant_id, TenantAccountJoin.account_id == account.id)
            .limit(1)
        )
        if not exists:
            new_member_count += 1

    return new_member_count


def _count_current_members(tenant_id: str) -> int:
    return (
        db.session.scalar(select(func.count(TenantAccountJoin.id)).where(TenantAccountJoin.tenant_id == tenant_id)) or 0
    )


def _check_member_invite_limits(tenant_id: str, new_member_count: int) -> None:
    if new_member_count <= 0:
        return

    features = FeatureService.get_features(tenant_id=tenant_id, exclude_vector_space=True)

    if dify_config.ENTERPRISE_ENABLED:
        workspace_members = features.workspace_members
        if workspace_members.enabled is True and not workspace_members.is_available(new_member_count):
            raise WorkspaceMembersLimitExceeded()
        return

    if dify_config.BILLING_ENABLED and features.billing.enabled is True:
        members = features.members
        current_member_count = _count_current_members(tenant_id)
        if 0 < members.limit < current_member_count + new_member_count:
            raise WorkspaceMembersLimitExceeded()


@console_ns.route("/workspaces/current/members")
class MemberListApi(Resource):
    """List all members of current tenant."""

    @setup_required
    @login_required
    @account_initialization_required
    @console_ns.response(200, "Success", console_ns.models[AccountWithRoleList.__name__])
    @with_current_user
    def get(self, current_user: Account | None = None):
        if current_user is None:
            current_user, _ = current_account_with_tenant()
        if not current_user.current_tenant:
            raise ValueError("No current tenant")
        members = TenantService.get_tenant_members(current_user.current_tenant, session=db.session)
        if dify_config.RBAC_ENABLED:
            member_ids = [member.id for member in members]
            member_roles = enterprise_rbac_service.RBACService.MemberRoles.batch_get(
                str(current_user.current_tenant.id),
                current_user.id,
                member_ids,
            )
            roles_map = {item.account_id: item.roles for item in member_roles}
        else:
            roles_map = {}

        serialized_members = []
        for member in members:
            current_role = _normalize_enum_value(member.current_role)
            serialized_members.append(
                {
                    "id": member.id,
                    "name": member.name,
                    "email": member.email,
                    "avatar": member.avatar,
                    "last_login_at": member.last_login_at,
                    "last_active_at": member.last_active_at,
                    "created_at": member.created_at,
                    "role": current_role,
                    "roles": _serialize_member_roles(current_role, roles_map.get(member.id, [])),
                    "status": _normalize_enum_value(member.status),
                }
            )

        member_models = TypeAdapter(list[AccountWithRole]).validate_python(serialized_members)
        response = AccountWithRoleList(accounts=member_models)
        return response.model_dump(mode="json"), 200


@console_ns.route("/workspaces/current/members/invite-email")
class MemberInviteEmailApi(Resource):
    """Invite a new member by email."""

    @console_ns.expect(console_ns.models[MemberInvitePayload.__name__])
    @console_ns.response(201, "Success", console_ns.models[MemberInviteResponse.__name__])
    @setup_required
    @login_required
    @account_initialization_required
    @with_current_user
    def post(self, current_user: Account):
        payload = console_ns.payload or {}
        args = MemberInvitePayload.model_validate(payload)

        invitee_emails = _normalize_invitee_emails(args.emails)
        invitee_role = args.role
        interface_language = args.language
        if not dify_config.RBAC_ENABLED:
            if not TenantAccountRole.is_valid_role(invitee_role):
                return {"code": "invalid-role", "message": "Invalid role"}, 400
            if not TenantAccountRole.is_non_owner_role(TenantAccountRole(invitee_role)):
                return {"code": "invalid-role", "message": "Invalid role"}, 400
        inviter = current_user
        if not inviter.current_tenant:
            raise ValueError("No current tenant")
        if not _is_role_enabled(invitee_role, inviter.current_tenant.id):
            return {"code": "invalid-role", "message": "Invalid role"}, 400

        # Check workspace permission for member invitations
        from libs.workspace_permission import check_workspace_member_invite_permission

        check_workspace_member_invite_permission(inviter.current_tenant.id)

        invitation_results = []
        console_web_url = dify_config.CONSOLE_WEB_URL

        tenant_id = inviter.current_tenant.id
        with redis_client.lock(f"workspace_member_invite:{tenant_id}", timeout=60):
            if dify_config.ENTERPRISE_ENABLED is True or dify_config.BILLING_ENABLED is True:
                new_member_count = _count_new_member_invites(tenant_id, invitee_emails)
                _check_member_invite_limits(tenant_id, new_member_count)

            for invitee_email in invitee_emails:
                try:
                    if not inviter.current_tenant:
                        raise ValueError("No current tenant")
                    token = RegisterService.invite_new_member(
                        tenant=inviter.current_tenant,
                        email=invitee_email,
                        language=interface_language,
                        role=invitee_role,
                        inviter=inviter,
                        session=db.session,
                    )
                    encoded_invitee_email = parse.quote(invitee_email)
                    invitation_results.append(
                        {
                            "status": "success",
                            "email": invitee_email,
                            "url": f"{console_web_url}/activate?email={encoded_invitee_email}&token={token}",
                        }
                    )
                except AccountAlreadyInTenantError:
                    invitation_results.append(
                        {
                            "status": "already_member",
                            "email": invitee_email,
                            "message": "Account already in workspace.",
                        }
                    )
                except Exception as e:
                    invitation_results.append({"status": "failed", "email": invitee_email, "message": str(e)})

        return {
            "result": "success",
            "invitation_results": invitation_results,
            "tenant_id": str(inviter.current_tenant.id) if inviter.current_tenant else "",
        }, 201


@console_ns.route("/workspaces/current/members/<uuid:member_id>")
class MemberCancelInviteApi(Resource):
    """Cancel an invitation by member id."""

    @console_ns.response(200, "Success", console_ns.models[MemberActionTenantResponse.__name__])
    @setup_required
    @login_required
    @account_initialization_required
    @with_current_user
    def delete(self, current_user: Account, member_id: UUID):
        if not current_user.current_tenant:
            raise ValueError("No current tenant")
        member = db.session.get(Account, str(member_id))
        if member is None:
            abort(404)
        else:
            try:
                TenantService.remove_member_from_tenant(
                    current_user.current_tenant, member, current_user, session=db.session
                )
            except services.errors.account.CannotOperateSelfError as e:
                return {"code": "cannot-operate-self", "message": str(e)}, 400
            except services.errors.account.NoPermissionError as e:
                return {"code": "forbidden", "message": str(e)}, 403
            except services.errors.account.MemberNotInTenantError as e:
                return {"code": "member-not-found", "message": str(e)}, 404
            except Exception as e:
                raise ValueError(str(e))

        return {
            "result": "success",
            "tenant_id": str(current_user.current_tenant.id) if current_user.current_tenant else "",
        }, 200


@console_ns.route("/workspaces/current/members/<uuid:member_id>/update-role")
class MemberUpdateRoleApi(Resource):
    """Update member role."""

    @console_ns.expect(console_ns.models[MemberRoleUpdatePayload.__name__])
    @console_ns.response(200, "Success", console_ns.models[SimpleResultResponse.__name__])
    @setup_required
    @login_required
    @account_initialization_required
    @with_current_user
    def put(self, current_user: Account, member_id: UUID):
        payload = console_ns.payload or {}
        args = MemberRoleUpdatePayload.model_validate(payload)
        new_role = args.role

        if not TenantAccountRole.is_valid_role(new_role):
            return {"code": "invalid-role", "message": "Invalid role"}, 400
        if not current_user.current_tenant:
            raise ValueError("No current tenant")
        if not _is_role_enabled(new_role, current_user.current_tenant.id):
            return {"code": "invalid-role", "message": "Invalid role"}, 400
        member = db.session.get(Account, str(member_id))
        if not member:
            abort(404)

        try:
            assert member is not None, "Member not found"
            TenantService.update_member_role(
                current_user.current_tenant, member, new_role, current_user, session=db.session
            )
        except services.errors.account.CannotOperateSelfError as e:
            return {"code": "cannot-operate-self", "message": str(e)}, 400
        except services.errors.account.NoPermissionError as e:
            return {"code": "forbidden", "message": str(e)}, 403
        except services.errors.account.MemberNotInTenantError as e:
            return {"code": "member-not-found", "message": str(e)}, 404
        except services.errors.account.RoleAlreadyAssignedError as e:
            return {"code": "role-already-assigned", "message": str(e)}, 400
        except Exception as e:
            raise ValueError(str(e))

        return {"result": "success"}


@console_ns.route("/workspaces/current/dataset-operators")
class DatasetOperatorMemberListApi(Resource):
    """List all members of current tenant."""

    @setup_required
    @login_required
    @account_initialization_required
    @console_ns.response(200, "Success", console_ns.models[AccountWithRoleList.__name__])
    @with_current_user
    def get(self, current_user: Account):
        if not current_user.current_tenant:
            raise ValueError("No current tenant")
        members = TenantService.get_dataset_operator_members(current_user.current_tenant, session=db.session)
        member_models = TypeAdapter(list[AccountWithRole]).validate_python(members, from_attributes=True)
        response = AccountWithRoleList(accounts=member_models)
        return response.model_dump(mode="json"), 200


@console_ns.route("/workspaces/current/members/send-owner-transfer-confirm-email")
class SendOwnerTransferEmailApi(Resource):
    """Send owner transfer email."""

    @console_ns.expect(console_ns.models[OwnerTransferEmailPayload.__name__])
    @console_ns.response(200, "Success", console_ns.models[SimpleResultDataResponse.__name__])
    @setup_required
    @login_required
    @account_initialization_required
    @is_allow_transfer_owner
    @with_current_user
    def post(self, current_user: Account):
        payload = console_ns.payload or {}
        args = OwnerTransferEmailPayload.model_validate(payload)
        ip_address = extract_remote_ip(request)
        if AccountService.is_email_send_ip_limit(ip_address):
            raise EmailSendIpLimitError()
        # check if the current user is the owner of the workspace
        if not current_user.current_tenant:
            raise ValueError("No current tenant")
        if not TenantService.is_owner(current_user, current_user.current_tenant, session=db.session):
            raise NotOwnerError()

        if args.language is not None and args.language == "zh-Hans":
            language = "zh-Hans"
        else:
            language = "en-US"

        email = current_user.email

        token = AccountService.send_owner_transfer_email(
            account=current_user,
            email=email,
            language=language,
            workspace_name=current_user.current_tenant.name if current_user.current_tenant else "",
        )

        return {"result": "success", "data": token}


@console_ns.route("/workspaces/current/members/owner-transfer-check")
class OwnerTransferCheckApi(Resource):
    @console_ns.expect(console_ns.models[OwnerTransferCheckPayload.__name__])
    @console_ns.response(200, "Success", console_ns.models[VerificationTokenResponse.__name__])
    @setup_required
    @login_required
    @account_initialization_required
    @is_allow_transfer_owner
    @with_current_user
    def post(self, current_user: Account):
        payload = console_ns.payload or {}
        args = OwnerTransferCheckPayload.model_validate(payload)
        # check if the current user is the owner of the workspace
        if not current_user.current_tenant:
            raise ValueError("No current tenant")
        if not TenantService.is_owner(current_user, current_user.current_tenant, session=db.session):
            raise NotOwnerError()

        user_email = current_user.email

        is_owner_transfer_error_rate_limit = AccountService.is_owner_transfer_error_rate_limit(user_email)
        if is_owner_transfer_error_rate_limit:
            raise OwnerTransferLimitError()

        token_data = AccountService.get_owner_transfer_data(args.token)
        if token_data is None:
            raise InvalidTokenError()

        if user_email != token_data.get("email"):
            raise InvalidEmailError()

        if args.code != token_data.get("code"):
            AccountService.add_owner_transfer_error_rate_limit(user_email)
            raise EmailCodeError()

        # Verified, revoke the first token
        AccountService.revoke_owner_transfer_token(args.token)

        # Refresh token data by generating a new token
        _, new_token = AccountService.generate_owner_transfer_token(user_email, code=args.code, additional_data={})

        AccountService.reset_owner_transfer_error_rate_limit(user_email)
        return {"is_valid": True, "email": token_data.get("email"), "token": new_token}


@console_ns.route("/workspaces/current/members/<uuid:member_id>/owner-transfer")
class OwnerTransfer(Resource):
    @console_ns.expect(console_ns.models[OwnerTransferPayload.__name__])
    @console_ns.response(200, "Success", console_ns.models[SimpleResultResponse.__name__])
    @setup_required
    @login_required
    @account_initialization_required
    @is_allow_transfer_owner
    @with_current_user
    def post(self, current_user: Account, member_id: UUID):
        payload = console_ns.payload or {}
        args = OwnerTransferPayload.model_validate(payload)

        # check if the current user is the owner of the workspace
        if not current_user.current_tenant:
            raise ValueError("No current tenant")
        if not TenantService.is_owner(current_user, current_user.current_tenant, session=db.session):
            raise NotOwnerError()

        if current_user.id == str(member_id):
            raise CannotTransferOwnerToSelfError()

        transfer_token_data = AccountService.get_owner_transfer_data(args.token)
        if not transfer_token_data:
            raise InvalidTokenError()

        if transfer_token_data.get("email") != current_user.email:
            raise InvalidEmailError()

        AccountService.revoke_owner_transfer_token(args.token)

        member = db.session.get(Account, str(member_id))
        if not member:
            abort(404)
            return  # Never reached, but helps type checker

        if not current_user.current_tenant:
            raise ValueError("No current tenant")
        if not TenantService.is_member(member, current_user.current_tenant, session=db.session):
            raise MemberNotInTenantError()

        try:
            assert member is not None, "Member not found"
            TenantService.update_member_role(
                current_user.current_tenant, member, "owner", current_user, session=db.session
            )

            AccountService.send_new_owner_transfer_notify_email(
                account=member,
                email=member.email,
                workspace_name=current_user.current_tenant.name if current_user.current_tenant else "",
            )

            AccountService.send_old_owner_transfer_notify_email(
                account=current_user,
                email=current_user.email,
                workspace_name=current_user.current_tenant.name if current_user.current_tenant else "",
                new_owner_email=member.email,
            )

        except Exception as e:
            raise ValueError(str(e))

        return {"result": "success"}
