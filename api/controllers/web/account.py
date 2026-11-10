"""Account settings for cookie-authenticated WebApp users without Builder admission."""

from http import HTTPStatus

from flask import make_response
from flask_restx import Resource
from pydantic import BaseModel, ConfigDict, Field, computed_field, model_validator
from werkzeug.exceptions import Unauthorized

from controllers.common.account import AccountProfilePatchPayload
from controllers.common.schema import register_response_schema_models, register_schema_models
from controllers.console.error import InvalidAccountPasswordRequestError
from controllers.console.workspace.error import CurrentPasswordIncorrectError, RepeatPasswordNotMatchError
from controllers.console.wraps import email_password_login_enabled
from controllers.web import web_ns
from controllers.web.account_admission import web_account_context
from extensions.ext_application_services import application_services
from fields.base import ResponseModel
from libs.external_api import error_responses
from libs.helper import build_avatar_url, dump_response
from services.account_errors import (
    AccountNotFoundError,
    CurrentAccountPasswordIncorrectError,
    InvalidAccountPasswordError,
)


class WebAccountResponse(ResponseModel):
    """Personal settings only; credentials, login IPs and Builder lifecycle stay private."""

    name: str
    email: str
    avatar: str | None
    is_password_set: bool
    interface_language: str | None
    interface_theme: str | None
    timezone: str | None

    @computed_field(return_type=str | None)  # type: ignore[prop-decorator]
    @property
    def avatar_url(self) -> str | None:
        return build_avatar_url(self.avatar)


class WebAccountProfileResponse(WebAccountResponse):
    has_owned_tenant: bool | None = Field(
        default=None,
        description="Whether the Account owns an existing tenant, including archived tenants. Null means unavailable.",
    )
    has_tenant: bool | None = Field(
        default=None,
        description="Whether the Account has a tenant membership, including ownership. Null means unavailable.",
    )


class WebAccountPasswordPayload(BaseModel):
    model_config = ConfigDict(extra="forbid", hide_input_in_errors=True)

    password: str = Field(
        default="", description="Current password; may be omitted only before the first password is set."
    )
    new_password: str
    repeat_new_password: str

    @model_validator(mode="after")
    def check_passwords_match(self) -> "WebAccountPasswordPayload":
        """Require matching confirmation before any credential change; mismatch is a client error."""
        if self.new_password != self.repeat_new_password:
            raise RepeatPasswordNotMatchError()
        return self


register_schema_models(web_ns, AccountProfilePatchPayload, WebAccountPasswordPayload)
register_response_schema_models(web_ns, WebAccountResponse, WebAccountProfileResponse)


@web_ns.route("/account/profile")
class WebAccountProfileApi(Resource):
    @web_ns.doc(
        description="Get personal Account settings using the WebApp Account cookie, without App or workspace scope."
    )
    @web_ns.response(HTTPStatus.OK, "Account profile", web_ns.models[WebAccountProfileResponse.__name__])
    def get(self):
        """Return private settings for an admitted Account; unavailable Accounts return 401 without caching."""
        context = web_account_context()
        try:
            account = application_services().accounts.profile.get(context)
        except AccountNotFoundError as error:
            raise Unauthorized("Account login required.") from error
        response = make_response(dump_response(WebAccountProfileResponse, account))
        response.headers["Cache-Control"] = "no-store"
        return response

    @web_ns.expect(web_ns.models[AccountProfilePatchPayload.__name__])
    @web_ns.response(HTTPStatus.OK, "Updated Account settings", web_ns.models[WebAccountResponse.__name__])
    def patch(self):
        """Update submitted profile fields for a same-origin Account cookie, without changing identity or membership."""
        context = web_account_context()
        payload = AccountProfilePatchPayload.model_validate(web_ns.payload or {})
        try:
            account = application_services().accounts.profile.update(context, payload.to_changes())
        except AccountNotFoundError as error:
            raise Unauthorized("Account login required.") from error
        response = make_response(dump_response(WebAccountResponse, account))
        response.headers["Cache-Control"] = "no-store"
        return response


@web_ns.route("/account/password")
class WebAccountPasswordApi(Resource):
    @web_ns.expect(web_ns.models[WebAccountPasswordPayload.__name__])
    @web_ns.response(HTTPStatus.OK, "Updated Account settings", web_ns.models[WebAccountResponse.__name__])
    @error_responses(CurrentPasswordIncorrectError, InvalidAccountPasswordRequestError, RepeatPasswordNotMatchError)
    @email_password_login_enabled
    def post(self):
        """Set or change the admitted Account's password when password login is enabled.

        A same-origin Account cookie is required. Existing credentials require the
        current password; confirmation and policy failures leave credentials unchanged.
        """
        context = web_account_context()
        payload = WebAccountPasswordPayload.model_validate(web_ns.payload or {})
        try:
            account = application_services().accounts.password.change(
                context, current_password=payload.password, new_password=payload.new_password
            )
        except CurrentAccountPasswordIncorrectError as error:
            raise CurrentPasswordIncorrectError() from error
        except InvalidAccountPasswordError as error:
            raise InvalidAccountPasswordRequestError(description=str(error)) from error
        except AccountNotFoundError as error:
            raise Unauthorized("Account login required.") from error
        response = make_response(dump_response(WebAccountResponse, account))
        response.headers["Cache-Control"] = "no-store"
        return response
