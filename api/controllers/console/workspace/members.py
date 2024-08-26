from flask_login import current_user
from flask_restful import Resource, abort, marshal_with, reqparse

import services
from configs import dify_config
from controllers.console import api
from controllers.console.setup import setup_required
from controllers.console.wraps import account_initialization_required, cloud_edition_billing_resource_check
from extensions.ext_database import db
from fields.member_fields import account_with_role_list_fields
from libs.login import login_required
from models.account import Account, TenantAccountRole
from services.account_service import RegisterService, TenantService
from services.errors.account import AccountAlreadyInTenantError


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
        for invitee_email in invitee_emails:
            try:
                token = RegisterService.invite_new_member(
                    inviter.current_tenant, invitee_email, interface_language, role=invitee_role, inviter=inviter
                )
                invitation_results.append(
                    {
                        "status": "success",
                        "email": invitee_email,
                        "url": f"{console_web_url}/activate?email={invitee_email}&token={token}",
                    }
                )
            except AccountAlreadyInTenantError:
                invitation_results.append(
                    {"status": "success", "email": invitee_email, "url": f"{console_web_url}/signin"}
                )
                break
            except Exception as e:
                invitation_results.append({"status": "failed", "email": invitee_email, "message": str(e)})

        return {
            "result": "success",
            "invitation_results": invitation_results,
        }, 201


class MemberCancelInviteApi(Resource):
    """Cancel an invitation by member id."""

    @setup_required
    @login_required
    @account_initialization_required
    def delete(self, member_id):
        member = db.session.query(Account).filter(Account.id == str(member_id)).first()
        if not member:
            abort(404)

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

        return {"result": "success"}, 204


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


api.add_resource(MemberListApi, "/workspaces/current/members")
api.add_resource(MemberInviteEmailApi, "/workspaces/current/members/invite-email")
api.add_resource(MemberCancelInviteApi, "/workspaces/current/members/<uuid:member_id>")
api.add_resource(MemberUpdateRoleApi, "/workspaces/current/members/<uuid:member_id>/update-role")
api.add_resource(DatasetOperatorMemberListApi, "/workspaces/current/dataset-operators")
