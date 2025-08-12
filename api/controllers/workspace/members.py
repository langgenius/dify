from flask import request
from flask_restful import Resource, fields, marshal_with, reqparse
from werkzeug.exceptions import BadRequest, NotFound

from controllers.workspace import api
from extensions.ext_database import db
from libs.login import login_required_for_workspace_api
from models.account import Account, TenantAccountJoin

member_fields = {
    "id": fields.String,
    "name": fields.String,
    "email": fields.String,
    "role": fields.String,
    "status": fields.String,
    "created_at": fields.DateTime(dt_format="iso8601"),
    "last_login_at": fields.DateTime(dt_format="iso8601"),
    "interface_language": fields.String,
}

member_list_fields = {
    "data": fields.List(fields.Nested(member_fields)),
    "total": fields.Integer,
    "page": fields.Integer,
    "limit": fields.Integer,
}


class WorkspaceMembersApi(Resource):
    @login_required_for_workspace_api(["members:read"])
    @marshal_with(member_list_fields)
    def get(self):
        """Get list of workspace members"""
        tenant_id = request.auth_data.get("tenant_id")

        # Parse query parameters
        parser = reqparse.RequestParser()
        parser.add_argument("page", type=int, default=1, location="args")
        parser.add_argument("limit", type=int, default=20, location="args")
        parser.add_argument("search", type=str, default="", location="args")
        parser.add_argument("role", type=str, location="args")

        args = parser.parse_args()

        # Build query
        query = (
            db.session.query(Account, TenantAccountJoin)
            .join(TenantAccountJoin, Account.id == TenantAccountJoin.account_id)
            .filter(TenantAccountJoin.tenant_id == tenant_id)
        )

        # Apply search filter
        if args["search"]:
            query = query.filter(
                db.or_(Account.name.ilike(f"%{args['search']}%"), Account.email.ilike(f"%{args['search']}%"))
            )

        # Apply role filter
        if args["role"]:
            query = query.filter(TenantAccountJoin.role == args["role"])

        # Get total count
        total = query.count()

        # Apply pagination
        offset = (args["page"] - 1) * args["limit"]
        results = query.offset(offset).limit(args["limit"]).all()

        members = []
        for account, join in results:
            members.append(self._serialize_member(account, join))

        return {
            "data": members,
            "total": total,
            "page": args["page"],
            "limit": args["limit"],
        }

    @login_required_for_workspace_api(["members:write"])
    @marshal_with(member_fields)
    def post(self):
        """Invite new member to workspace"""
        tenant_id = request.auth_data.get("tenant_id")

        parser = reqparse.RequestParser()
        parser.add_argument("email", type=str, required=True, location="json")
        parser.add_argument(
            "role", type=str, required=True, location="json", choices=["admin", "normal", "editor", "dataset_operator"]
        )

        args = parser.parse_args()

        # Check if user already exists
        existing_account = db.session.query(Account).filter(Account.email == args["email"]).first()

        if existing_account:
            # Check if already a member
            existing_join = (
                db.session.query(TenantAccountJoin)
                .filter(TenantAccountJoin.account_id == existing_account.id, TenantAccountJoin.tenant_id == tenant_id)
                .first()
            )

            if existing_join:
                raise BadRequest("User is already a member of this workspace")

            # Add existing user to workspace
            join = TenantAccountJoin(tenant_id=tenant_id, account_id=existing_account.id, role=args["role"])

            db.session.add(join)
            db.session.commit()

            return self._serialize_member(existing_account, join)
        else:
            # TODO: Send invitation email for new user
            # For now, return error
            raise BadRequest("User does not exist. Email invitation functionality not implemented yet.")

    def _serialize_member(self, account: Account, join: TenantAccountJoin) -> dict:
        """Serialize member object"""
        return {
            "id": account.id,
            "name": account.name,
            "email": account.email,
            "role": join.role,
            "status": account.status,
            "created_at": join.created_at,
            "last_login_at": account.last_login_at,
            "interface_language": account.interface_language,
        }


class WorkspaceMemberApi(Resource):
    @login_required_for_workspace_api(["members:read"])
    @marshal_with(member_fields)
    def get(self, member_id):
        """Get specific member"""
        tenant_id = request.auth_data.get("tenant_id")

        result = (
            db.session.query(Account, TenantAccountJoin)
            .join(TenantAccountJoin, Account.id == TenantAccountJoin.account_id)
            .filter(TenantAccountJoin.tenant_id == tenant_id, Account.id == member_id)
            .first()
        )

        if not result:
            raise NotFound("Member not found")

        account, join = result
        return self._serialize_member(account, join)

    @login_required_for_workspace_api(["members:write"])
    @marshal_with(member_fields)
    def put(self, member_id):
        """Update member role"""
        tenant_id = request.auth_data.get("tenant_id")

        parser = reqparse.RequestParser()
        parser.add_argument(
            "role", type=str, required=True, location="json", choices=["admin", "normal", "editor", "dataset_operator"]
        )

        args = parser.parse_args()

        # Find member
        result = (
            db.session.query(Account, TenantAccountJoin)
            .join(TenantAccountJoin, Account.id == TenantAccountJoin.account_id)
            .filter(TenantAccountJoin.tenant_id == tenant_id, Account.id == member_id)
            .first()
        )

        if not result:
            raise NotFound("Member not found")

        account, join = result

        # Prevent changing owner role
        if join.role == "owner":
            raise BadRequest("Cannot change owner role")

        # Update role
        join.role = args["role"]
        db.session.commit()

        return self._serialize_member(account, join)

    @login_required_for_workspace_api(["members:admin"])
    def delete(self, member_id):
        """Remove member from workspace"""
        tenant_id = request.auth_data.get("tenant_id")

        # Find member
        join = (
            db.session.query(TenantAccountJoin)
            .filter(TenantAccountJoin.tenant_id == tenant_id, TenantAccountJoin.account_id == member_id)
            .first()
        )

        if not join:
            raise NotFound("Member not found")

        # Prevent removing owner
        if join.role == "owner":
            raise BadRequest("Cannot remove workspace owner")

        db.session.delete(join)
        db.session.commit()

        return {"message": "Member removed successfully"}

    def _serialize_member(self, account: Account, join: TenantAccountJoin) -> dict:
        """Serialize member object"""
        return {
            "id": account.id,
            "name": account.name,
            "email": account.email,
            "role": join.role,
            "status": account.status,
            "created_at": join.created_at,
            "last_login_at": account.last_login_at,
            "interface_language": account.interface_language,
        }


api.add_resource(WorkspaceMembersApi, "/members")
api.add_resource(WorkspaceMemberApi, "/members/<string:member_id>")
