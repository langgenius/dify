"""Account settings for cookie-authenticated WebApp users without Builder admission."""

from http import HTTPStatus

from flask import make_response, request
from flask_restx import Resource
from pydantic import BaseModel, ConfigDict, Field, computed_field, model_validator
from werkzeug.exceptions import Unauthorized

from controllers.common.account import AccountProfilePatchPayload
from controllers.common.end_user_connections import ConnectionLoginRequiredError
from controllers.common.fields import SimpleResultResponse
from controllers.common.schema import register_response_schema_models, register_schema_models
from controllers.common.web_login import WebLoginExchangePayload, WebLoginUnavailableHTTPError, web_login_errors
from controllers.console.error import InvalidAccountPasswordRequestError
from controllers.console.workspace.error import CurrentPasswordIncorrectError, RepeatPasswordNotMatchError
from controllers.console.wraps import email_password_login_enabled, model_validate
from controllers.web import web_ns
from controllers.web.account_admission import require_web_account_origin, web_account_context
from extensions.ext_application_services import application_services
from fields.base import ResponseModel
from libs.external_api import error_responses
from libs.helper import build_avatar_url, dump_response
from libs.token import set_webapp_access_token_to_cookie
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


register_schema_models(web_ns, AccountProfilePatchPayload, WebAccountPasswordPayload, WebLoginExchangePayload)
register_response_schema_models(web_ns, WebAccountResponse, WebAccountProfileResponse, SimpleResultResponse)


@web_ns.route("/account/session")
class WebAccountSessionApi(Resource):
    @web_ns.doc("exchange_web_account_login")
    @web_ns.expect(web_ns.models[WebLoginExchangePayload.__name__])
    @web_ns.response(HTTPStatus.OK, "Account session established", web_ns.models[SimpleResultResponse.__name__])
    @error_responses(ConnectionLoginRequiredError, WebLoginUnavailableHTTPError)
    @model_validate(WebLoginExchangePayload)
    def post(self, payload: WebLoginExchangePayload):
        """Require the WebApp Origin and a portal code bound to this verifier.

        Success sets only the Web Account cookie, never a Console token or App Passport.
        Rejected origins, invalid proofs, and replays do not set any cookies.
        """
        require_web_account_origin()
        with web_login_errors():
            session = application_services().web_login_handoff.redeem_portal(
                code=payload.login_code, code_verifier=payload.code_verifier
            )
        # response-contract:ignore credential-bearing response
        response = make_response(dump_response(SimpleResultResponse, {"result": "success"}))
        set_webapp_access_token_to_cookie(request, response, session.access_token, expires_at=session.expires_at)
        response.headers["Cache-Control"] = "no-store"
        return response


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
