"""Whole-Guest Web resource migration after Account login."""

from typing import Annotated, Literal

from flask import request
from flask_restx import Resource
from pydantic import BaseModel, ConfigDict, Field

from configs import dify_config
from controllers.common.end_user_connections import ConnectionConflictHTTPError, ConnectionLoginRequiredError
from controllers.common.schema import register_response_schema_models, register_schema_models
from controllers.common.web_login import web_login_errors
from controllers.console.wraps import model_validate
from controllers.web import web_ns
from controllers.web.error import WebAppAuthAccessDeniedError, WebAppNotFoundError
from extensions.ext_application_services import application_services
from fields.base import ResponseModel
from libs.exception import BaseHTTPException
from libs.external_api import error_responses
from libs.helper import dump_response
from libs.token import extract_webapp_access_token
from services.end_user_connections.errors import ConnectionConflictError, ConnectionIdentityError
from services.web_migration_service import (
    ConnectionClaimFailure,
    ConnectionClaimPreflightError,
    ConnectionClaimUnavailableError,
    MigrationRunInProgressError,
)
from services.web_passport_service import (
    WebPassportAccessDeniedError,
    WebPassportAccountExchangeDisabledError,
    WebPassportAuthenticationRequiredError,
    WebPassportNotFoundError,
    WebPassportUnauthorizedError,
)


class ConnectionClaimPayload(BaseModel):
    model_config = ConfigDict(extra="forbid")

    passports: list[Annotated[str, Field(min_length=1, max_length=8192)]] = Field(
        min_length=1, max_length=50, repr=False
    )


class ConnectionClaimSuccessResponse(ResponseModel):
    status: Literal["success"]
    index: int = Field(ge=0)
    app_code: str
    access_token: str
    claimed_conversations: int = Field(
        ge=0, description="Chat conversations transferred; excludes Completion bookkeeping"
    )
    claimed_connections: int = Field(
        ge=0, description="Number transferred by this item; zero when no Guest Connections remain"
    )


class ConnectionClaimErrorResponse(ResponseModel):
    code: Literal[
        "app_not_found",
        "connection_claim_unavailable",
        "connection_conflict",
        "end_user_login_required",
        "migration_run_in_progress",
        "unauthorized",
        "web_app_access_denied",
    ]
    message: str
    status: int


class ConnectionClaimFailureResponse(ResponseModel):
    status: Literal["failed"]
    index: int = Field(ge=0)
    error: ConnectionClaimErrorResponse


class ConnectionClaimPreflightDetails(BaseModel):
    failures: list[ConnectionClaimFailureResponse]


class ConnectionClaimPreflightHTTPError(BaseHTTPException):
    code = 400
    error_code = "connection_claim_preflight_failed"
    description = "Guest migration preflight failed. No resources were transferred."
    details_model = ConnectionClaimPreflightDetails


class ConnectionClaimUnavailableHTTPError(BaseHTTPException):
    code = 503
    error_code = "connection_claim_unavailable"
    description = "Guest migration is temporarily unavailable. Please retry."


class ConnectionClaimResponse(ResponseModel):
    data: list[
        Annotated[ConnectionClaimSuccessResponse | ConnectionClaimFailureResponse, Field(discriminator="status")]
    ]


def claim_error_response(failure: ConnectionClaimFailure) -> ConnectionClaimErrorResponse:
    error = failure.error
    if isinstance(error, ConnectionIdentityError):
        return ConnectionClaimErrorResponse(code="unauthorized", status=401, message=str(error))
    if isinstance(error, WebPassportNotFoundError):
        return ConnectionClaimErrorResponse(
            code="app_not_found", status=404, message=str(WebAppNotFoundError.description)
        )
    if isinstance(error, (WebPassportAuthenticationRequiredError, WebPassportUnauthorizedError)):
        return ConnectionClaimErrorResponse(
            code="end_user_login_required", status=401, message=str(ConnectionLoginRequiredError.description)
        )
    if isinstance(error, WebPassportAccessDeniedError):
        return ConnectionClaimErrorResponse(
            code="web_app_access_denied", status=401, message=str(WebAppAuthAccessDeniedError.description)
        )
    if isinstance(error, MigrationRunInProgressError):
        return ConnectionClaimErrorResponse(code="migration_run_in_progress", status=409, message=str(error))
    if isinstance(error, ConnectionConflictError):
        return ConnectionClaimErrorResponse(
            code="connection_conflict", status=409, message=str(ConnectionConflictHTTPError.description)
        )
    if isinstance(error, ConnectionClaimUnavailableError):
        return ConnectionClaimErrorResponse(code="connection_claim_unavailable", status=503, message=str(error))
    raise error


register_schema_models(web_ns, ConnectionClaimPayload)
register_response_schema_models(
    web_ns,
    ConnectionClaimSuccessResponse,
    ConnectionClaimErrorResponse,
    ConnectionClaimFailureResponse,
    ConnectionClaimResponse,
)


@web_ns.route("/migration/claim")
class ConnectionClaimApi(Resource):
    @web_ns.doc(
        description="Claim up to 50 anonymous browser Passports across Web Apps for one authenticated Account. "
        "Submit Guest Passports in passports, with one Account Web login proof "
        "in its HttpOnly cookie or Authorization. "
        "Complete the login handoff through /api/passport before asking the user to confirm Claim. "
        "Validate every source Passport and Account App admission before any transfer or identity creation. "
        "Preflight failures return 400 connection_claim_preflight_failed with details.failures indexed by input. "
        "An unavailable preflight dependency returns 503; neither failure starts a transfer. "
        "Items run in input order with independent transactions; every item returns its index and success or failure. "
        "Every Passport transfers all Connections, files, conversations and personal state atomically. "
        "Pending execution acceptance must finish starting before migration. "
        "All unfinished Guest runs must complete or be cancelled before migration. "
        "Success includes the App code, Account App Passport and both transferred resource counts. "
        "Retries transfer only resources still owned by the Guest; empty resource categories report zero. "
        "New Guest resources are included. "
        "Account defaults take precedence; Conversation IDs, history and execution provenance are preserved. "
        "Resubmit the same batch or retry failed items separately; no cross-App atomicity is provided."
    )
    @web_ns.expect(web_ns.models[ConnectionClaimPayload.__name__])
    @web_ns.response(200, "Whole Guest migration results", web_ns.models[ConnectionClaimResponse.__name__])
    @error_responses(
        ConnectionLoginRequiredError, ConnectionClaimPreflightHTTPError, ConnectionClaimUnavailableHTTPError
    )
    @model_validate(ConnectionClaimPayload)
    def post(self, payload: ConnectionClaimPayload):
        with web_login_errors():
            if not dify_config.WEBAPP_ACCOUNT_PASSPORT_ENABLED:
                raise WebPassportAccountExchangeDisabledError()
            login_token = extract_webapp_access_token(request) or ""
            try:
                results = application_services().web_migration.claim(payload.passports, access_token=login_token)
            except ConnectionClaimPreflightError as exc:
                error = ConnectionClaimPreflightHTTPError()
                assert error.data is not None
                error.data["details"] = ConnectionClaimPreflightDetails(
                    failures=[
                        ConnectionClaimFailureResponse(
                            status="failed", index=failure.index, error=claim_error_response(failure)
                        )
                        for failure in exc.failures
                    ]
                ).model_dump(mode="json")
                raise error from exc
            except ConnectionClaimUnavailableError as exc:
                raise ConnectionClaimUnavailableHTTPError() from exc
        data: list[ConnectionClaimSuccessResponse | ConnectionClaimFailureResponse] = []
        for result in results:
            if isinstance(result, ConnectionClaimFailure):
                data.append(
                    ConnectionClaimFailureResponse(
                        status="failed", index=result.index, error=claim_error_response(result)
                    )
                )
            else:
                data.append(
                    ConnectionClaimSuccessResponse(
                        status="success",
                        index=result.index,
                        app_code=result.app_code,
                        access_token=result.access_token,
                        claimed_connections=result.claimed_connections,
                        claimed_conversations=result.claimed_conversations,
                    )
                )
        return (
            dump_response(ConnectionClaimResponse, {"data": data}),
            200,
            {"Cache-Control": "no-store"},
        )


class ClaimablePassportsPayload(BaseModel):
    model_config = ConfigDict(extra="forbid")

    passports: list[Annotated[str, Field(min_length=1, max_length=8192)]] = Field(max_length=50, repr=False)


class ClaimablePassportResponse(ResponseModel):
    index: int = Field(ge=0, description="Index of the candidate in the request's passports list")
    app_code: str
    app_name: str
    conversation_count: int = Field(
        ge=0, description="Remaining user-facing Chat conversations; Workflow normally has zero"
    )
    connection_count: int = Field(
        ge=0, description="Current Guest Connection count; does not determine Passport eligibility"
    )


class ClaimablePassportsResponse(ResponseModel):
    data: list[ClaimablePassportResponse]


register_schema_models(web_ns, ClaimablePassportsPayload)
register_response_schema_models(web_ns, ClaimablePassportResponse, ClaimablePassportsResponse)


@web_ns.route("/migration/claimable-passports")
class ClaimablePassportsApi(Resource):
    @web_ns.doc(
        description="Check anonymous Passports held by this browser across Web Apps without changing identity or data. "
        "Submit local candidates; return request indices, App names/codes and current Connection/conversation counts. "
        "Invalid, expired, duplicate, Account and SSO candidates are omitted. No Account login is required. "
        "Unavailable, disabled and unpublished Web Apps are filtered out. "
        "Zero-Connection Guest Passports are included. "
        "Supports Workflow, Chatflow and classic Chat/AgentChat/Completion; the new Agent runtime is excluded. "
        "conversation_count counts chat history; Workflow has none and Completion bookkeeping is not counted. "
        "connection_count counts all currently Guest-owned Connections, including ones needing reconnection. "
        "This is advisory: actual Claim rechecks ownership and Account App admission."
    )
    @web_ns.expect(web_ns.models[ClaimablePassportsPayload.__name__])
    @web_ns.response(200, "Claimable browser Passports", web_ns.models[ClaimablePassportsResponse.__name__])
    @model_validate(ClaimablePassportsPayload)
    def post(self, payload: ClaimablePassportsPayload):
        with web_login_errors():
            if not dify_config.WEBAPP_ACCOUNT_PASSPORT_ENABLED:
                raise WebPassportAccountExchangeDisabledError()
            candidates = application_services().web_migration.claimable_passports(payload.passports)
        return (
            dump_response(
                ClaimablePassportsResponse,
                {
                    "data": [
                        ClaimablePassportResponse(
                            index=index,
                            app_code=candidate.app_code,
                            app_name=candidate.app_name,
                            connection_count=candidate.connection_count,
                            conversation_count=candidate.conversation_count,
                        )
                        for index, candidate in candidates
                    ]
                },
            ),
            200,
            {"Cache-Control": "no-store"},
        )
