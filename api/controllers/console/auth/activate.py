from flask import request
from flask_restx import Resource
from pydantic import BaseModel, Field, field_validator

from constants.languages import supported_language
from controllers.common.schema import query_params_from_model, register_schema_models
from controllers.console import console_ns
from controllers.console.auth.error import InvitationAccountMismatchError as InvitationAccountMismatchHTTPError
from controllers.console.error import AccountInFreezeError, AlreadyActivateError, EmailDomainSuspendedError
from extensions.ext_application_services import application_services
from libs.helper import EmailStr, dump_response, timezone
from libs.login import current_account_with_tenant
from libs.token import extract_access_token
from services.account_activation_service import (
    EmailDomainSuspendedError as EmailDomainSuspendedRegistrationError,
)
from services.account_activation_service import (
    FrozenAccountError,
    InvalidInvitationError,
    InvitationAccountMismatchError,
)
from services.entities.account_activation_entities import ActivationCommand, InvitationLookup


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
        result = application_services().account_activation.check(
            InvitationLookup(
                workspace_id=args.workspace_id,
                email=args.email,
                token=args.token,
            ),
        )
        return ActivationCheckResponse.model_validate(result, from_attributes=True).model_dump(
            mode="json",
            exclude_none=True,
        )


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
        """Accept an invitation without letting an existing session act for another account.

        Token-only activation remains available for legacy clients. When the request already
        carries a console session, that session must belong to the account encoded in the
        invitation before the token is consumed or tenant membership is changed.
        """
        args = ActivatePayload.model_validate(console_ns.payload or {})
        authenticated_account_id: str | None = None
        if extract_access_token(request) is not None:
            authenticated_account_id = current_account_with_tenant().account.id

        try:
            application_services().account_activation.activate(
                ActivationCommand(
                    invitation=InvitationLookup(
                        workspace_id=args.workspace_id,
                        email=args.email,
                        token=args.token,
                    ),
                    name=args.name,
                    interface_language=args.interface_language,
                    timezone=args.timezone,
                ),
                authenticated_account_id=authenticated_account_id,
            )
        except InvalidInvitationError:
            raise AlreadyActivateError() from None
        except InvitationAccountMismatchError:
            raise InvitationAccountMismatchHTTPError() from None
        except EmailDomainSuspendedRegistrationError:
            raise EmailDomainSuspendedError() from None
        except FrozenAccountError:
            raise AccountInFreezeError() from None

        return dump_response(ActivationResponse, {"result": "success"})
