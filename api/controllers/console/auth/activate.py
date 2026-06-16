from flask import request
from flask_restx import Resource
from pydantic import BaseModel, Field, field_validator
from sqlalchemy import select

from configs import dify_config
from constants.languages import supported_language
from controllers.common.schema import query_params_from_model, register_schema_models
from controllers.console import console_ns
from controllers.console.error import AccountInFreezeError, AlreadyActivateError
from extensions.ext_database import db
from libs.datetime_utils import naive_utc_now
from libs.helper import EmailStr, timezone
from models import AccountStatus
from models.account import TenantAccountJoin, TenantAccountRole
from services.account_service import RegisterService, TenantService
from services.billing_service import BillingService


class ActivateCheckQuery(BaseModel):
    workspace_id: str | None = Field(default=None)
    email: EmailStr | None = Field(default=None)
    token: str


class ActivatePayload(BaseModel):
    workspace_id: str | None = Field(default=None)
    email: EmailStr | None = Field(default=None)
    token: str
    name: str | None = Field(default=None, max_length=30)
    interface_language: str | None = Field(default=None)
    timezone: str | None = Field(default=None)

    @field_validator("interface_language")
    @classmethod
    def validate_lang(cls, value: str | None) -> str | None:
        if value is None:
            return None
        return supported_language(value)

    @field_validator("timezone")
    @classmethod
    def validate_tz(cls, value: str | None) -> str | None:
        if value is None:
            return None
        return timezone(value)


class ActivationResponse(BaseModel):
    result: str = Field(description="Operation result")


class ActivationCheckData(BaseModel):
    workspace_name: str | None
    workspace_id: str | None
    email: str | None
    account_status: str | None = None
    requires_setup: bool | None = None


class ActivationCheckResponse(BaseModel):
    is_valid: bool = Field(description="Whether token is valid")
    data: ActivationCheckData | None = Field(default=None, description="Activation data if valid")


register_schema_models(
    console_ns,
    ActivateCheckQuery,
    ActivatePayload,
    ActivationCheckData,
    ActivationCheckResponse,
    ActivationResponse,
)


@console_ns.route("/activate/check")
class ActivateCheckApi(Resource):
    @console_ns.doc("check_activation_token")
    @console_ns.doc(description="Check if activation token is valid")
    @console_ns.doc(params=query_params_from_model(ActivateCheckQuery))
    @console_ns.response(
        200,
        "Success",
        console_ns.models[ActivationCheckResponse.__name__],
    )
    def get(self):
        args = ActivateCheckQuery.model_validate(request.args.to_dict(flat=True))

        workspaceId = args.workspace_id
        token = args.token

        invitation = RegisterService.get_invitation_with_case_fallback(workspaceId, args.email, token)
        if invitation:
            data = invitation.get("data", {})
            tenant = invitation.get("tenant", None)

            # Check workspace permission
            if tenant:
                from libs.workspace_permission import check_workspace_member_invite_permission

                check_workspace_member_invite_permission(tenant.id)

            workspace_name = tenant.name if tenant else None
            workspace_id = tenant.id if tenant else None
            invitee_email = data.get("email") if data else None
            account = invitation.get("account")
            account_status = account.status if account else None
            requires_setup = data.get("requires_setup")
            if requires_setup is None:
                requires_setup = account_status == AccountStatus.PENDING
            return {
                "is_valid": invitation is not None,
                "data": {
                    "workspace_name": workspace_name,
                    "workspace_id": workspace_id,
                    "email": invitee_email,
                    "account_status": account_status,
                    "requires_setup": requires_setup,
                },
            }
        else:
            return {"is_valid": False}


@console_ns.route("/activate")
class ActivateApi(Resource):
    @console_ns.doc("activate_account")
    @console_ns.doc(description="Activate account with invitation token")
    @console_ns.expect(console_ns.models[ActivatePayload.__name__])
    @console_ns.response(
        200,
        "Account activated successfully",
        console_ns.models[ActivationResponse.__name__],
    )
    @console_ns.response(400, "Already activated or invalid token")
    def post(self):
        args = ActivatePayload.model_validate(console_ns.payload)

        normalized_request_email = args.email.lower() if args.email else None
        invitation = RegisterService.get_invitation_with_case_fallback(args.workspace_id, args.email, args.token)
        if invitation is None:
            raise AlreadyActivateError()

        account = invitation["account"]
        if dify_config.BILLING_ENABLED and BillingService.is_email_in_freeze(account.email):
            raise AccountInFreezeError()

        tenant = invitation["tenant"]
        raw_role = invitation["data"].get("role")
        try:
            role = TenantAccountRole(raw_role) if raw_role else TenantAccountRole.NORMAL
        except ValueError:
            role = TenantAccountRole.NORMAL
        if not TenantAccountRole.is_non_owner_role(role):
            role = TenantAccountRole.NORMAL

        membership_id = db.session.scalar(
            select(TenantAccountJoin.id).where(
                TenantAccountJoin.tenant_id == tenant.id,
                TenantAccountJoin.account_id == account.id,
            )
        )

        requires_setup = invitation["data"].get("requires_setup")
        if requires_setup is None:
            requires_setup = account.status == AccountStatus.PENDING

        setup_fields: tuple[str, str, str] | None = None
        if requires_setup:
            if not args.name or not args.interface_language or not args.timezone:
                raise AlreadyActivateError()
            setup_fields = (args.name, args.interface_language, args.timezone)

        RegisterService.revoke_token(args.workspace_id, normalized_request_email, args.token)

        if membership_id is None:
            TenantService.create_tenant_member(tenant, account, str(role))

        if setup_fields:
            account.name = setup_fields[0]
            account.interface_language = setup_fields[1]
            account.timezone = setup_fields[2]
            account.interface_theme = "light"
            account.status = AccountStatus.ACTIVE
            account.initialized_at = naive_utc_now()

        TenantService.switch_tenant(account, tenant.id)

        return {"result": "success"}
