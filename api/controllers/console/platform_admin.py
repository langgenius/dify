from urllib import parse

from flask import abort, request
from flask_restx import Resource, fields, marshal_with
from pydantic import BaseModel, Field, TypeAdapter

from configs import dify_config
from controllers.common.schema import register_enum_models, register_schema_models
from controllers.console import console_ns
from controllers.console.wraps import account_initialization_required, platform_admin_required, setup_required
from extensions.ext_database import db
from fields.member_fields import AccountWithRole, AccountWithRoleList, SimpleAccount
from libs.login import current_account_with_tenant, login_required
from models.account import Account, TenantAccountRole
from services.errors.account import AccountAlreadyInTenantError, MemberNotInTenantError, RoleAlreadyAssignedError
from services.feature_service import FeatureService
from services.platform_admin_service import PlatformAdminService

DEFAULT_REF_TEMPLATE_SWAGGER_2_0 = "#/definitions/{model}"


class PlatformAdminWorkspaceListQuery(BaseModel):
    page: int = Field(default=1, ge=1, le=99999)
    limit: int = Field(default=50, ge=1, le=200)
    keyword: str | None = None


class PlatformAdminWorkspaceCreatePayload(BaseModel):
    name: str = Field(min_length=1, max_length=255)
    owner_email: str | None = None
    owner_name: str | None = Field(default=None, max_length=255)


class PlatformAdminWorkspaceUpdatePayload(BaseModel):
    name: str = Field(min_length=1, max_length=255)


class PlatformAdminMemberInvitePayload(BaseModel):
    emails: list[str] = Field(default_factory=list)
    role: TenantAccountRole
    language: str | None = None


class PlatformAdminMemberRoleUpdatePayload(BaseModel):
    role: TenantAccountRole


class PlatformAdminMemberPasswordResetPayload(BaseModel):
    new_password: str = Field(min_length=1)
    password_confirm: str = Field(min_length=1)


def reg(cls: type[BaseModel]) -> None:
    console_ns.schema_model(cls.__name__, cls.model_json_schema(ref_template=DEFAULT_REF_TEMPLATE_SWAGGER_2_0))


for model in (
    PlatformAdminWorkspaceListQuery,
    PlatformAdminWorkspaceCreatePayload,
    PlatformAdminWorkspaceUpdatePayload,
    PlatformAdminMemberInvitePayload,
    PlatformAdminMemberRoleUpdatePayload,
    PlatformAdminMemberPasswordResetPayload,
):
    reg(model)

register_enum_models(console_ns, TenantAccountRole)
register_schema_models(console_ns, AccountWithRole, AccountWithRoleList, SimpleAccount)

workspace_owner_fields = {
    "id": fields.String,
    "name": fields.String,
    "email": fields.String,
}

workspace_summary_fields = {
    "id": fields.String,
    "name": fields.String,
    "plan": fields.String,
    "status": fields.String,
    "created_at": fields.Integer,
    "member_count": fields.Integer,
    "owner": fields.Nested(workspace_owner_fields, allow_null=True),
}

workspace_list_fields = {
    "items": fields.List(fields.Nested(workspace_summary_fields)),
    "page": fields.Integer,
    "limit": fields.Integer,
    "total": fields.Integer,
}

workspace_create_fields = {
    "workspace": fields.Nested(workspace_summary_fields),
    "owner_invitation_url": fields.String(default=None),
}


@console_ns.route("/platform-admin/workspaces")
class PlatformAdminWorkspaceListApi(Resource):
    @console_ns.expect(console_ns.models[PlatformAdminWorkspaceListQuery.__name__])
    @setup_required
    @login_required
    @account_initialization_required
    @platform_admin_required
    @marshal_with(workspace_list_fields)
    def get(self):
        args = PlatformAdminWorkspaceListQuery.model_validate(request.args.to_dict(flat=True))  # type: ignore[arg-type]
        items, total = PlatformAdminService.list_workspaces(page=args.page, limit=args.limit, keyword=args.keyword)
        return {"items": items, "page": args.page, "limit": args.limit, "total": total}

    @console_ns.expect(console_ns.models[PlatformAdminWorkspaceCreatePayload.__name__])
    @setup_required
    @login_required
    @account_initialization_required
    @platform_admin_required
    @marshal_with(workspace_create_fields)
    def post(self):
        payload = console_ns.payload or {}
        args = PlatformAdminWorkspaceCreatePayload.model_validate(payload)
        current_user, _ = current_account_with_tenant()
        tenant, invitation_url = PlatformAdminService.create_workspace(
            name=args.name,
            owner_email=args.owner_email,
            owner_name=args.owner_name,
            inviter=current_user,
            language=current_user.interface_language,
        )
        return {
            "workspace": PlatformAdminService.serialize_workspace(tenant),
            "owner_invitation_url": invitation_url,
        }, 201


@console_ns.route("/platform-admin/workspaces/<uuid:workspace_id>")
class PlatformAdminWorkspaceApi(Resource):
    @console_ns.expect(console_ns.models[PlatformAdminWorkspaceUpdatePayload.__name__])
    @setup_required
    @login_required
    @account_initialization_required
    @platform_admin_required
    @marshal_with(workspace_summary_fields)
    def patch(self, workspace_id):
        payload = console_ns.payload or {}
        args = PlatformAdminWorkspaceUpdatePayload.model_validate(payload)
        tenant = PlatformAdminService.get_workspace(str(workspace_id))
        updated_tenant = PlatformAdminService.rename_workspace(tenant=tenant, name=args.name)
        return PlatformAdminService.serialize_workspace(updated_tenant)

    @setup_required
    @login_required
    @account_initialization_required
    @platform_admin_required
    def delete(self, workspace_id):
        current_user, _ = current_account_with_tenant()
        tenant = PlatformAdminService.get_workspace(str(workspace_id))
        PlatformAdminService.delete_workspace(tenant=tenant, operator=current_user)
        return {"result": "success"}, 200


@console_ns.route("/platform-admin/workspaces/<uuid:workspace_id>/members")
class PlatformAdminWorkspaceMemberListApi(Resource):
    @setup_required
    @login_required
    @account_initialization_required
    @platform_admin_required
    @console_ns.response(200, "Success", console_ns.models[AccountWithRoleList.__name__])
    def get(self, workspace_id):
        tenant = PlatformAdminService.get_workspace(str(workspace_id))
        members = PlatformAdminService.get_workspace_members(tenant)
        member_models = TypeAdapter(list[AccountWithRole]).validate_python(members, from_attributes=True)
        response = AccountWithRoleList(accounts=member_models)
        return response.model_dump(mode="json"), 200


@console_ns.route("/platform-admin/workspaces/<uuid:workspace_id>/members/invite")
class PlatformAdminWorkspaceMemberInviteApi(Resource):
    @console_ns.expect(console_ns.models[PlatformAdminMemberInvitePayload.__name__])
    @setup_required
    @login_required
    @account_initialization_required
    @platform_admin_required
    def post(self, workspace_id):
        payload = console_ns.payload or {}
        args = PlatformAdminMemberInvitePayload.model_validate(payload)
        if not TenantAccountRole.is_non_owner_role(args.role):
            return {"code": "invalid-role", "message": "Invalid role"}, 400

        tenant = PlatformAdminService.get_workspace(str(workspace_id))
        workspace_members = FeatureService.get_features(tenant_id=tenant.id).workspace_members
        if not workspace_members.is_available(len(args.emails)):
            return {"code": "workspace-members-limit-exceeded", "message": "Workspace members limit exceeded."}, 403

        current_user, _ = current_account_with_tenant()
        invitation_results = []

        for email in args.emails:
            normalized_email = email.lower()
            try:
                token = PlatformAdminService.invite_member(
                    tenant=tenant,
                    email=normalized_email,
                    language=args.language,
                    role=args.role,
                    inviter=current_user,
                )
                encoded_email = parse.quote(normalized_email)
                invitation_results.append(
                    {
                        "status": "success",
                        "email": normalized_email,
                        "url": f"{dify_config.CONSOLE_WEB_URL}/activate?email={encoded_email}&token={token}",
                    }
                )
            except AccountAlreadyInTenantError:
                invitation_results.append(
                    {"status": "success", "email": normalized_email, "url": f"{dify_config.CONSOLE_WEB_URL}/signin"}
                )
            except Exception as e:
                invitation_results.append({"status": "failed", "email": normalized_email, "message": str(e)})

        return {
            "result": "success",
            "invitation_results": invitation_results,
            "tenant_id": tenant.id,
        }, 201


@console_ns.route("/platform-admin/workspaces/<uuid:workspace_id>/members/<uuid:member_id>/role")
class PlatformAdminWorkspaceMemberRoleApi(Resource):
    @console_ns.expect(console_ns.models[PlatformAdminMemberRoleUpdatePayload.__name__])
    @setup_required
    @login_required
    @account_initialization_required
    @platform_admin_required
    def put(self, workspace_id, member_id):
        payload = console_ns.payload or {}
        args = PlatformAdminMemberRoleUpdatePayload.model_validate(payload)
        if not TenantAccountRole.is_non_owner_role(args.role):
            return {"code": "invalid-role", "message": "Invalid role"}, 400

        tenant = PlatformAdminService.get_workspace(str(workspace_id))
        member = db.session.get(Account, str(member_id))
        if not member:
            abort(404)

        try:
            PlatformAdminService.update_member_role(tenant=tenant, member=member, new_role=args.role)
        except MemberNotInTenantError as e:
            return {"code": "member-not-found", "message": str(e)}, 404
        except RoleAlreadyAssignedError as e:
            return {"code": "role-already-assigned", "message": str(e)}, 400

        return {"result": "success"}, 200


@console_ns.route("/platform-admin/workspaces/<uuid:workspace_id>/members/<uuid:member_id>/password")
class PlatformAdminWorkspaceMemberPasswordApi(Resource):
    @console_ns.expect(console_ns.models[PlatformAdminMemberPasswordResetPayload.__name__])
    @setup_required
    @login_required
    @account_initialization_required
    @platform_admin_required
    def post(self, workspace_id, member_id):
        payload = console_ns.payload or {}
        args = PlatformAdminMemberPasswordResetPayload.model_validate(payload)
        if args.new_password != args.password_confirm:
            return {"code": "password-mismatch", "message": "Passwords do not match."}, 400

        tenant = PlatformAdminService.get_workspace(str(workspace_id))
        member = db.session.get(Account, str(member_id))
        if not member:
            abort(404)

        try:
            PlatformAdminService.reset_member_password(
                tenant=tenant,
                member=member,
                new_password=args.new_password,
            )
        except MemberNotInTenantError as e:
            return {"code": "member-not-found", "message": str(e)}, 404
        except ValueError as e:
            return {"code": "invalid-password-reset", "message": str(e)}, 400

        return {"result": "success"}, 200


@console_ns.route("/platform-admin/workspaces/<uuid:workspace_id>/members/<uuid:member_id>")
class PlatformAdminWorkspaceMemberApi(Resource):
    @setup_required
    @login_required
    @account_initialization_required
    @platform_admin_required
    def delete(self, workspace_id, member_id):
        tenant = PlatformAdminService.get_workspace(str(workspace_id))
        member = db.session.get(Account, str(member_id))
        if not member:
            abort(404)

        try:
            PlatformAdminService.remove_member(tenant=tenant, account=member)
        except MemberNotInTenantError as e:
            return {"code": "member-not-found", "message": str(e)}, 404

        return {"result": "success"}, 200
