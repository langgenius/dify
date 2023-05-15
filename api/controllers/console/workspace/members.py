# -*- coding:utf-8 -*-

from flask_login import login_required, current_user
from flask_restful import Resource, reqparse, marshal_with, abort, fields, marshal

import services
from controllers.console import api
from controllers.console.setup import setup_required
from controllers.console.wraps import account_initialization_required
from libs.helper import TimestampField
from extensions.ext_database import db
from models.account import Account, TenantAccountJoin
from services.account_service import TenantService, RegisterService

account_fields = {
    'id': fields.String,
    'name': fields.String,
    'avatar': fields.String,
    'email': fields.String,
    'last_login_at': TimestampField,
    'created_at': TimestampField,
    'role': fields.String,
    'status': fields.String,
}

account_list_fields = {
    'accounts': fields.List(fields.Nested(account_fields))
}


class MemberListApi(Resource):
    """List all members of current tenant."""

    @setup_required
    @login_required
    @account_initialization_required
    @marshal_with(account_list_fields)
    def get(self):
        members = TenantService.get_tenant_members(current_user.current_tenant)
        return {'result': 'success', 'accounts': members}, 200


class MemberInviteEmailApi(Resource):
    """Invite a new member by email."""

    @setup_required
    @login_required
    @account_initialization_required
    def post(self):
        parser = reqparse.RequestParser()
        parser.add_argument('email', type=str, required=True, location='json')
        parser.add_argument('role', type=str, required=True, default='admin', location='json')
        args = parser.parse_args()

        invitee_email = args['email']
        invitee_role = args['role']
        if invitee_role not in ['admin', 'normal']:
            return {'code': 'invalid-role', 'message': 'Invalid role'}, 400

        inviter = current_user

        try:
            RegisterService.invite_new_member(inviter.current_tenant, invitee_email, role=invitee_role, inviter=inviter)
            account = db.session.query(Account, TenantAccountJoin.role).join(
                TenantAccountJoin, Account.id == TenantAccountJoin.account_id
            ).filter(Account.email == args['email']).first()
            account, role = account
            account = marshal(account, account_fields)
            account['role'] = role
        except services.errors.account.CannotOperateSelfError as e:
            return {'code': 'cannot-operate-self', 'message': str(e)}, 400
        except services.errors.account.NoPermissionError as e:
            return {'code': 'forbidden', 'message': str(e)}, 403
        except services.errors.account.AccountAlreadyInTenantError as e:
            return {'code': 'email-taken', 'message': str(e)}, 409
        except Exception as e:
            return {'code': 'unexpected-error', 'message': str(e)}, 500

        # todo:413

        return {'result': 'success', 'account': account}, 201


class MemberCancelInviteApi(Resource):
    """Cancel an invitation by member id."""

    @setup_required
    @login_required
    @account_initialization_required
    def delete(self, member_id):
        member = Account.query.get(str(member_id))
        if not member:
            abort(404)

        try:
            TenantService.remove_member_from_tenant(current_user.current_tenant, member, current_user)
        except services.errors.account.CannotOperateSelfError as e:
            return {'code': 'cannot-operate-self', 'message': str(e)}, 400
        except services.errors.account.NoPermissionError as e:
            return {'code': 'forbidden', 'message': str(e)}, 403
        except services.errors.account.MemberNotInTenantError as e:
            return {'code': 'member-not-found', 'message': str(e)}, 404
        except Exception as e:
            raise ValueError(str(e))

        return {'result': 'success'}, 204


class MemberUpdateRoleApi(Resource):
    """Update member role."""

    @setup_required
    @login_required
    @account_initialization_required
    def put(self, member_id):
        parser = reqparse.RequestParser()
        parser.add_argument('role', type=str, required=True, location='json')
        args = parser.parse_args()
        new_role = args['role']

        if new_role not in ['admin', 'normal', 'owner']:
            return {'code': 'invalid-role', 'message': 'Invalid role'}, 400

        member = Account.query.get(str(member_id))
        if not member:
            abort(404)

        try:
            TenantService.update_member_role(current_user.current_tenant, member, new_role, current_user)
        except Exception as e:
            raise ValueError(str(e))

        # todo: 403

        return {'result': 'success'}


api.add_resource(MemberListApi, '/workspaces/current/members')
api.add_resource(MemberInviteEmailApi, '/workspaces/current/members/invite-email')
api.add_resource(MemberCancelInviteApi, '/workspaces/current/members/<uuid:member_id>')
api.add_resource(MemberUpdateRoleApi, '/workspaces/current/members/<uuid:member_id>/update-role')
