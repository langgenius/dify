from flask import request
from flask_restx import Resource, fields
from pydantic import BaseModel, Field, field_validator

from constants.languages import supported_language
from controllers.console import console_ns
from controllers.console.error import AlreadyActivateError
from extensions.ext_database import db
from libs.datetime_utils import naive_utc_now
from libs.helper import EmailStr, extract_remote_ip, timezone
from models import AccountStatus
from services.account_service import AccountService, RegisterService

DEFAULT_REF_TEMPLATE_SWAGGER_2_0 = "#/definitions/{model}"


class ActivateCheckQuery(BaseModel):
    workspace_id: str | None = Field(default=None)
    email: EmailStr | None = Field(default=None)
    token: str


class ActivatePayload(BaseModel):
    workspace_id: str | None = Field(default=None)
    email: EmailStr | None = Field(default=None)
    token: str
    name: str = Field(..., max_length=30)
    interface_language: str = Field(...)
    timezone: str = Field(...)

    @field_validator("interface_language")
    @classmethod
    def validate_lang(cls, value: str) -> str:
        return supported_language(value)

    @field_validator("timezone")
    @classmethod
    def validate_tz(cls, value: str) -> str:
        return timezone(value)


for model in (ActivateCheckQuery, ActivatePayload):
    console_ns.schema_model(model.__name__, model.model_json_schema(ref_template=DEFAULT_REF_TEMPLATE_SWAGGER_2_0))


@console_ns.route("/activate/check")
class ActivateCheckApi(Resource):
    @console_ns.doc("check_activation_token")
    @console_ns.doc(description="Check if activation token is valid")
    @console_ns.expect(console_ns.models[ActivateCheckQuery.__name__])
    @console_ns.response(
        200,
        "Success",
        console_ns.model(
            "ActivationCheckResponse",
            {
                "is_valid": fields.Boolean(description="Whether token is valid"),
                "data": fields.Raw(description="Activation data if valid"),
            },
        ),
    )
    def get(self):
        args = ActivateCheckQuery.model_validate(request.args.to_dict(flat=True))  # type: ignore

        workspaceId = args.workspace_id
        reg_email = args.email
        token = args.token

        invitation = RegisterService.get_invitation_if_token_valid(workspaceId, reg_email, token)
        if invitation:
            data = invitation.get("data", {})
            tenant = invitation.get("tenant", None)
            workspace_name = tenant.name if tenant else None
            workspace_id = tenant.id if tenant else None
            invitee_email = data.get("email") if data else None
            return {
                "is_valid": invitation is not None,
                "data": {"workspace_name": workspace_name, "workspace_id": workspace_id, "email": invitee_email},
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
        console_ns.model(
            "ActivationResponse",
            {
                "result": fields.String(description="Operation result"),
                "data": fields.Raw(description="Login token data"),
            },
        ),
    )
    @console_ns.response(400, "Already activated or invalid token")
    def post(self):
        args = ActivatePayload.model_validate(console_ns.payload)

        invitation = RegisterService.get_invitation_if_token_valid(args.workspace_id, args.email, args.token)
        if invitation is None:
            raise AlreadyActivateError()

        RegisterService.revoke_token(args.workspace_id, args.email, args.token)

        account = invitation["account"]
        account.name = args.name

        account.interface_language = args.interface_language
        account.timezone = args.timezone
        account.interface_theme = "light"
        account.status = AccountStatus.ACTIVE
        account.initialized_at = naive_utc_now()
        db.session.commit()

        token_pair = AccountService.login(account, ip_address=extract_remote_ip(request))

        return {"result": "success", "data": token_pair.model_dump()}
