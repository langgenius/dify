from urllib import parse

from flask import request
from flask_login import current_user
from flask_restful import Resource, abort, marshal_with, reqparse

import services
from configs import dify_config
from controllers.console import api
from controllers.console.auth.error import EmailCodeError, InvalidEmailError, InvalidTokenError, OwnerTransferLimitError
from controllers.console.error import EmailSendIpLimitError, WorkspaceMembersLimitExceeded
from controllers.console.wraps import (
    account_initialization_required,
    cloud_edition_billing_resource_check,
    is_allow_transfer_owner,
    setup_required,
)
from extensions.ext_database import db
from fields.member_fields import account_with_role_list_fields
from libs.helper import extract_remote_ip
from libs.login import login_required
from models.account import Account, TenantAccountRole
from services.account_service import AccountService, RegisterService, TenantService
from services.errors.account import AccountAlreadyInTenantError
from services.feature_service import FeatureService


class MemberListApi(Resource):
    """List all members of current tenant."""

    @setup_required
    @login_required
    @account_initialization_required
    @marshal_with(account_with_role_list_fields)
    def get(self):
        members = TenantService.get_tenant_members(current_user.current_tenant)
        return {"result": "success", "accounts": members}, 200


class MemberInviteEmailApi(Resource):
    """Invite a new member by email."""

    @setup_required
    @login_required
    @account_initialization_required
    @cloud_edition_billing_resource_check("members")
    def post(self):
        parser = reqparse.RequestParser()
        parser.add_argument("emails", type=str, required=True, location="json", action="append")
        parser.add_argument("role", type=str, required=True, default="admin", location="json")
        parser.add_argument("language", type=str, required=False, location="json")
        args = parser.parse_args()

        invitee_emails = args["emails"]
        invitee_role = args["role"]
        interface_language = args["language"]
        if not TenantAccountRole.is_non_owner_role(invitee_role):
            return {"code": "invalid-role", "message": "Invalid role"}, 400

        inviter = current_user
        invitation_results = []
        console_web_url = dify_config.CONSOLE_WEB_URL

        workspace_members = FeatureService.get_features(tenant_id=inviter.current_tenant.id).workspace_members

        if not workspace_members.is_available(len(invitee_emails)):
            raise WorkspaceMembersLimitExceeded()

        for invitee_email in invitee_emails:
            try:
                token = RegisterService.invite_new_member(
                    inviter.current_tenant, invitee_email, interface_language, role=invitee_role, inviter=inviter
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
                    {"status": "success", "email": invitee_email, "url": f"{console_web_url}/signin"}
                )
            except Exception as e:
                invitation_results.append({"status": "failed", "email": invitee_email, "message": str(e)})

        return {
            "result": "success",
            "invitation_results": invitation_results,
            "tenant_id": str(current_user.current_tenant.id),
        }, 201


class MemberCancelInviteApi(Resource):
    """Cancel an invitation by member id."""

    @setup_required
    @login_required
    @account_initialization_required
    def delete(self, member_id):
        member = db.session.query(Account).filter(Account.id == str(member_id)).first()
        if member is None:
            abort(404)
        else:
            try:
                TenantService.remove_member_from_tenant(current_user.current_tenant, member, current_user)
            except services.errors.account.CannotOperateSelfError as e:
                return {"code": "cannot-operate-self", "message": str(e)}, 400
            except services.errors.account.NoPermissionError as e:
                return {"code": "forbidden", "message": str(e)}, 403
            except services.errors.account.MemberNotInTenantError as e:
                return {"code": "member-not-found", "message": str(e)}, 404
            except Exception as e:
                raise ValueError(str(e))

        return {"result": "success", "tenant_id": str(current_user.current_tenant.id)}, 200


class MemberUpdateRoleApi(Resource):
    """Update member role."""

    @setup_required
    @login_required
    @account_initialization_required
    def put(self, member_id):
        parser = reqparse.RequestParser()
        parser.add_argument("role", type=str, required=True, location="json")
        args = parser.parse_args()
        new_role = args["role"]

        if not TenantAccountRole.is_valid_role(new_role):
            return {"code": "invalid-role", "message": "Invalid role"}, 400

        member = db.session.get(Account, str(member_id))
        if not member:
            abort(404)

        try:
            assert member is not None, "Member not found"
            TenantService.update_member_role(current_user.current_tenant, member, new_role, current_user)
        except Exception as e:
            raise ValueError(str(e))

        # todo: 403

        return {"result": "success"}


class DatasetOperatorMemberListApi(Resource):
    """List all members of current tenant."""

    @setup_required
    @login_required
    @account_initialization_required
    @marshal_with(account_with_role_list_fields)
    def get(self):
        members = TenantService.get_dataset_operator_members(current_user.current_tenant)
        return {"result": "success", "accounts": members}, 200


class SendOwnerTransferEmailApi(Resource):
    """Send owner transfer email."""

    @setup_required
    @login_required
    @account_initialization_required
    @is_allow_transfer_owner
    def post(self, member_id):
        parser = reqparse.RequestParser()
        parser.add_argument("language", type=str, required=False, location="json")
        args = parser.parse_args()

        ip_address = extract_remote_ip(request)
        if AccountService.is_email_send_ip_limit(ip_address):
            raise EmailSendIpLimitError()

        if args["language"] is not None and args["language"] == "zh-Hans":
            language = "zh-Hans"
        else:
            language = "en-US"

        email = current_user.email
        member = db.session.get(Account, str(member_id))
        if not member:
            abort(404)
        else:
            member_name = member.name

        token = AccountService.send_owner_transfer_email(
            account=current_user,
            email=email,
            language=language,
            workspace_name=current_user.current_tenant.name,
            member_name=member_name,
        )

        return {"result": "success", "data": token}


class OwnerTransferCheckEApi(Resource):
    @setup_required
    @login_required
    @account_initialization_required
    @is_allow_transfer_owner
    def post(self):
        parser = reqparse.RequestParser()
        parser.add_argument("code", type=str, required=True, location="json")
        parser.add_argument("token", type=str, required=True, nullable=False, location="json")
        args = parser.parse_args()

        user_email = current_user.email

        is_owner_transfer_error_rate_limit = AccountService.is_owner_transfer_error_rate_limit(args["email"])
        if is_owner_transfer_error_rate_limit:
            raise OwnerTransferLimitError()

        token_data = AccountService.get_owner_transfer_data(args["token"])
        if token_data is None:
            raise InvalidTokenError()

        if user_email != token_data.get("email"):
            raise InvalidEmailError()

        if args["code"] != token_data.get("code"):
            AccountService.add_owner_transfer_error_rate_limit(args["email"])
            raise EmailCodeError()

        # Verified, revoke the first token
        AccountService.revoke_owner_transfer_token(args["token"])

        # Refresh token data by generating a new token
        _, new_token = AccountService.generate_owner_transfer_token(user_email, code=args["code"], additional_data={})

        AccountService.reset_owner_transfer_error_rate_limit(args["email"])
        return {"is_valid": True, "email": token_data.get("email"), "token": new_token}


class OwnerTransfer(Resource):
    @setup_required
    @login_required
    @account_initialization_required
    @is_allow_transfer_owner
    def post(self, member_id):
        parser = reqparse.RequestParser()
        parser.add_argument("token", type=str, required=True, nullable=False, location="json")
        args = parser.parse_args()

        transfer_token_data = AccountService.get_owner_transfer_data(args["token"])
        if not transfer_token_data:
            raise InvalidTokenError()

        if transfer_token_data.get("phase", "") != "owner_transfer":
            raise InvalidTokenError()

        if transfer_token_data.get("email") != current_user.email:
            raise InvalidEmailError()

        AccountService.revoke_owner_transfer_token(args["token"])

        member = db.session.get(Account, str(member_id))
        if not member:
            abort(404)

        try:
            assert member is not None, "Member not found"
            TenantService.update_member_role(current_user.current_tenant, member, "owner", current_user)
        except Exception as e:
            raise ValueError(str(e))

        return {"result": "success"}


api.add_resource(MemberListApi, "/workspaces/current/members")
api.add_resource(MemberInviteEmailApi, "/workspaces/current/members/invite-email")
api.add_resource(MemberCancelInviteApi, "/workspaces/current/members/<uuid:member_id>")
api.add_resource(MemberUpdateRoleApi, "/workspaces/current/members/<uuid:member_id>/update-role")
api.add_resource(DatasetOperatorMemberListApi, "/workspaces/current/dataset-operators")
# owner transfer
api.add_resource(
    SendOwnerTransferEmailApi, "/workspaces/current/members/<uuid:member_id>/send-owner-transfer-confirm-email"
)
api.add_resource(OwnerTransferCheckEApi, "/workspaces/current/members/owner-transfer-check")
api.add_resource(OwnerTransfer, "/workspaces/current/members/<uuid:member_id>/owner-transfer")
