"""Claim a Guest's personal Connections with separate Account authentication."""

from typing import Self

from flask import make_response, request
from pydantic import BaseModel, ConfigDict, Field, model_validator

from constants import HEADER_NAME_APP_CODE
from controllers.common.end_user_connections import (
    ConnectionConflictHTTPError,
    ConnectionLoginRequiredError,
    raise_connection_error,
)
from controllers.common.schema import register_response_schema_models, register_schema_models
from controllers.common.web_login import WebLoginUnavailableHTTPError, web_login_errors
from controllers.console.wraps import model_validate
from controllers.web import web_ns
from controllers.web.error import WebAppAuthAccessDeniedError
from controllers.web.passport import PassportLoginResponse
from controllers.web.wraps import WebApiResource
from extensions.ext_application_services import application_services
from libs.external_api import error_responses
from libs.helper import dump_response
from libs.token import extract_webapp_access_token
from models.model import App, EndUser
from services.end_user_connection_identity import connection_context_from_web_passport
from services.end_user_connections.errors import ConnectionError
from services.web_passport_service import WebPassportAccessDeniedError, WebPassportAuthenticationRequiredError


class ConnectionClaimPayload(BaseModel):
    model_config = ConfigDict(extra="forbid")

    login_code: str | None = Field(default=None, min_length=1, max_length=256, repr=False)
    code_verifier: str | None = Field(default=None, pattern=r"^[A-Za-z0-9._~-]{43,128}$", repr=False)

    @model_validator(mode="after")
    def validate_login_handoff(self) -> Self:
        if (self.login_code is None) != (self.code_verifier is None):
            raise ValueError("Provide both login_code and code_verifier, or use an existing Web login proof.")
        return self


class ConnectionClaimResponse(PassportLoginResponse):
    claimed_connections: int = Field(ge=0, description="Number transferred by the original claim; stable on retries")


register_schema_models(web_ns, ConnectionClaimPayload)
register_response_schema_models(web_ns, ConnectionClaimResponse)


@web_ns.route("/connections/claim")
class ConnectionClaimApi(WebApiResource):
    @web_ns.doc(
        description="Explicitly claim the current Guest's Connections for the authenticated Account. "
        "Send the old Guest Passport in X-App-Passport, and an Account Web login proof in Authorization "
        "or a PKCE login_code/code_verifier pair in the JSON body. Returns a new Account-linked App Passport. "
        "Account App defaults take precedence over Guest defaults; Conversation choices and history are preserved."
    )
    @web_ns.doc(
        params={"X-App-Code": {"in": "header", "required": True}, "X-App-Passport": {"in": "header", "required": True}}
    )
    @web_ns.expect(web_ns.models[ConnectionClaimPayload.__name__])
    @web_ns.response(200, "Guest Connections claimed", web_ns.models[ConnectionClaimResponse.__name__])
    @error_responses(ConnectionLoginRequiredError, ConnectionConflictHTTPError, WebLoginUnavailableHTTPError)
    @model_validate(ConnectionClaimPayload)
    def post(self, payload: ConnectionClaimPayload, app_model: App, end_user: EndUser):
        app_code = request.headers[HEADER_NAME_APP_CODE]
        with web_login_errors():
            login_token = extract_webapp_access_token(request) or ""
            if payload.login_code is not None and payload.code_verifier is not None:
                login_token = application_services().web_login_handoff.redeem(
                    app_code=app_code, code=payload.login_code, code_verifier=payload.code_verifier
                )
            try:
                result = application_services().end_user_connection_claims.claim(
                    connection_context_from_web_passport(app=app_model, end_user=end_user),
                    app_code=app_code,
                    access_token=login_token,
                )
            except WebPassportAuthenticationRequiredError as exc:
                raise ConnectionLoginRequiredError() from exc
            except WebPassportAccessDeniedError as exc:
                raise WebAppAuthAccessDeniedError() from exc
            except ConnectionError as error:
                raise_connection_error(error)
        # response-contract:ignore credential-bearing Flask response
        response = make_response(
            dump_response(
                ConnectionClaimResponse,
                {
                    "access_token": result.access_token,
                    "webapp_access_token": login_token,
                    "claimed_connections": result.claimed_connections,
                },
            )
        )
        response.headers["Cache-Control"] = "no-store"
        return response
