"""Account consumer APIs; admission never requires or provisions a workspace."""

from collections.abc import Generator
from contextlib import contextmanager
from datetime import datetime
from uuid import UUID

from flask import make_response, request
from flask_restx import Resource
from pydantic import Field, RootModel, ValidationError, field_serializer
from werkzeug.exceptions import NotFound, ServiceUnavailable, Unauthorized

from controllers.common.end_user_connection_oauth import complete_end_user_connection_oauth
from controllers.common.end_user_connections import (
    ConnectionCheckUnavailableHTTPError,
    ConnectionConfigurationHTTPError,
    ConnectionConflictHTTPError,
    ConnectionCredentialsHTTPError,
    ConnectionNotFoundHTTPError,
    ConnectionOAuthHTTPError,
    ConnectionReauthorizationHTTPError,
    ConnectionRevisionChangedHTTPError,
    ConnectionSecretUnavailableHTTPError,
    ConnectionUpdatePayload,
    raise_connection_error,
)
from controllers.common.schema import query_params_from_model, register_response_schema_models, register_schema_models
from controllers.console import console_ns
from core.entities.provider_entities import ProviderConfig
from extensions.ext_application_services import application_services
from fields.base import ResponseModel
from libs.datetime_utils import to_utc_timestamp
from libs.external_api import error_responses
from libs.helper import dump_response
from libs.token import check_csrf_token, extract_console_cookie_token
from services.consumer_service import ConsumerApp, ConsumerAppNotFoundError, ConsumerAppsQuery, ConsumerIdentity
from services.end_user_connections.contracts import (
    ConnectionContractInput,
    ConnectionRevisionView,
    ConnectionSummary,
    ListConnectionsInput,
)
from services.end_user_connections.errors import ConnectionError
from services.plugin.oauth_service import OAuthProxyService
from services.web_identity_service import WebIdentityError
from services.web_passport_service import WebPassportUnauthorizedError
from services.webapp_access_query_service import WebAppAccessUnavailableError


def _identity() -> ConsumerIdentity:
    try:
        identity = application_services().consumer.authenticate(extract_console_cookie_token(request))
    except (WebIdentityError, WebPassportUnauthorizedError):
        raise Unauthorized("Account login required.") from None
    check_csrf_token(request, identity.account_id)
    return identity


@contextmanager
def _errors() -> Generator[None]:
    try:
        yield
    except ValidationError:
        raise ValueError("Invalid consumer request.") from None
    except ConsumerAppNotFoundError:
        raise NotFound("App not found.") from None
    except WebAppAccessUnavailableError:
        raise ServiceUnavailable("App access is temporarily unavailable.") from None
    except ConnectionError as error:
        raise_connection_error(error)


class ConsumerAppResponse(ConsumerApp, ResponseModel):
    @field_serializer("last_used_at")
    def serialize_usage(self, value: datetime | None) -> int | None:
        return to_utc_timestamp(value) if value is not None else None


class ConsumerAppsResponse(ResponseModel):
    data: list[ConsumerAppResponse]
    has_more: bool
    next_cursor: str | None


class ConsumerConnectionResponse(ConnectionSummary, ResponseModel):
    @field_serializer("created_at", "updated_at", "last_active_at")
    def serialize_time(self, value: datetime) -> int:
        return to_utc_timestamp(value)

    @field_serializer("expires_at")
    def serialize_expiration(self, value: datetime | None) -> int | None:
        return to_utc_timestamp(value) if value is not None else None


class ConsumerConnectionDetailResponse(ResponseModel):
    connection: ConsumerConnectionResponse
    apps: list[ConsumerAppResponse]


class ConsumerConnectionsResponse(ResponseModel):
    data: list[ConsumerConnectionDetailResponse]
    has_more: bool
    next_cursor: str | None


class ConsumerConnectionsQuery(ListConnectionsInput):
    limit: int = Field(default=20, ge=1, le=100, strict=False)


class ConsumerConnectionRevisionResponse(ConnectionRevisionView, ResponseModel):
    pass


class ConsumerConnectionUpdatePayload(ConnectionUpdatePayload):
    pass


class ConsumerConnectionRevisionQuery(ConnectionContractInput):
    pass


class ConsumerReauthorizePayload(ConnectionContractInput):
    pass


class ConsumerCredentialSchemaResponse(RootModel[list[ProviderConfig]]):
    pass


class ConsumerOAuthResponse(ResponseModel):
    authorization_url: str


register_schema_models(
    console_ns,
    ConsumerConnectionUpdatePayload,
    ConsumerReauthorizePayload,
)
register_response_schema_models(
    console_ns,
    ConsumerAppResponse,
    ConsumerAppsResponse,
    ConsumerConnectionResponse,
    ConsumerConnectionDetailResponse,
    ConsumerConnectionsResponse,
    ConsumerConnectionRevisionResponse,
    ConsumerCredentialSchemaResponse,
    ConsumerOAuthResponse,
)


@console_ns.route("/me/apps")
class ConsumerAppsApi(Resource):
    @console_ns.doc(params=query_params_from_model(ConsumerAppsQuery))
    @console_ns.response(200, "Accessible personal Apps", console_ns.models[ConsumerAppsResponse.__name__])
    def get(self):
        identity = _identity()
        with _errors():
            query = ConsumerAppsQuery.model_validate(request.args.to_dict(flat=True))
            result = application_services().consumer.list_apps(identity, query)
        return dump_response(ConsumerAppsResponse, result)


@console_ns.route("/me/apps/<uuid:app_id>/favorite")
class ConsumerFavoriteApi(Resource):
    @console_ns.response(204, "App favorited")
    def put(self, app_id: UUID):
        identity = _identity()
        with _errors():
            application_services().consumer.set_favorite(identity, str(app_id), enabled=True)
        return "", 204

    @console_ns.response(204, "App unfavorited")
    def delete(self, app_id: UUID):
        identity = _identity()
        with _errors():
            application_services().consumer.set_favorite(identity, str(app_id), enabled=False)
        return "", 204


@console_ns.route("/me/connections")
class ConsumerConnectionsApi(Resource):
    @console_ns.doc(params=query_params_from_model(ConsumerConnectionsQuery))
    @console_ns.response(200, "Account Connections", console_ns.models[ConsumerConnectionsResponse.__name__])
    def get(self):
        identity = _identity()
        with _errors():
            query = ConsumerConnectionsQuery.model_validate(request.args.to_dict(flat=True))
            result = application_services().consumer.list_connections(
                identity,
                provider=query.provider,
                cursor=query.cursor,
                limit=query.limit,
            )
        return dump_response(ConsumerConnectionsResponse, result)


@console_ns.route("/me/connections/<uuid:connection_id>")
class ConsumerConnectionApi(Resource):
    @console_ns.response(200, "Owned Connection", console_ns.models[ConsumerConnectionDetailResponse.__name__])
    @error_responses(ConnectionNotFoundHTTPError)
    def get(self, connection_id: UUID):
        identity = _identity()
        with _errors():
            result = application_services().consumer.get_connection(identity, str(connection_id))
        return dump_response(ConsumerConnectionDetailResponse, result)

    @console_ns.expect(console_ns.models[ConsumerConnectionUpdatePayload.__name__])
    @console_ns.response(200, "Connection updated", console_ns.models[ConsumerConnectionResponse.__name__])
    @error_responses(
        ConnectionNotFoundHTTPError,
        ConnectionConfigurationHTTPError,
        ConnectionConflictHTTPError,
        ConnectionCredentialsHTTPError,
        ConnectionRevisionChangedHTTPError,
        ConnectionCheckUnavailableHTTPError,
        ConnectionSecretUnavailableHTTPError,
    )
    def patch(self, connection_id: UUID):
        identity = _identity()
        with _errors():
            command = ConsumerConnectionUpdatePayload.model_validate(console_ns.payload or {})
            result = application_services().consumer.update_connection(identity, str(connection_id), command)
        return dump_response(ConsumerConnectionResponse, result)

    @console_ns.response(204, "Connection disconnected")
    @error_responses(ConnectionNotFoundHTTPError, ConnectionConflictHTTPError)
    def delete(self, connection_id: UUID):
        identity = _identity()
        with _errors():
            application_services().consumer.delete_connection(identity, str(connection_id))
        return "", 204


@console_ns.route("/me/connections/<uuid:connection_id>/revision")
class ConsumerConnectionRevisionApi(Resource):
    @console_ns.response(
        200, "Current Provider revision", console_ns.models[ConsumerConnectionRevisionResponse.__name__]
    )
    @error_responses(ConnectionNotFoundHTTPError, ConnectionConfigurationHTTPError, ConnectionCheckUnavailableHTTPError)
    def get(self, connection_id: UUID):
        identity = _identity()
        with _errors():
            result = application_services().consumer.connection_revision(identity, str(connection_id))
        return dump_response(ConsumerConnectionRevisionResponse, result), 200, {"Cache-Control": "no-store"}


@console_ns.route("/me/connections/<uuid:connection_id>/credential-schema")
class ConsumerCredentialSchemaApi(Resource):
    @console_ns.doc(params=query_params_from_model(ConsumerConnectionRevisionQuery))
    @console_ns.response(
        200, "API-key replacement schema", console_ns.models[ConsumerCredentialSchemaResponse.__name__]
    )
    @error_responses(
        ConnectionNotFoundHTTPError,
        ConnectionConfigurationHTTPError,
        ConnectionRevisionChangedHTTPError,
        ConnectionCheckUnavailableHTTPError,
    )
    def get(self, connection_id: UUID):
        identity = _identity()
        with _errors():
            query = ConsumerConnectionRevisionQuery.model_validate(request.args.to_dict(flat=True))
            result = application_services().consumer.credential_schema(
                identity,
                str(connection_id),
                connection_revision=query.connection_revision,
            )
        return dump_response(ConsumerCredentialSchemaResponse, result), 200, {"Cache-Control": "no-store"}


@console_ns.route("/me/connections/<uuid:connection_id>/reauthorize")
class ConsumerReauthorizeApi(Resource):
    @console_ns.expect(console_ns.models[ConsumerReauthorizePayload.__name__])
    @console_ns.response(200, "OAuth reauthorization URL", console_ns.models[ConsumerOAuthResponse.__name__])
    @error_responses(
        ConnectionNotFoundHTTPError,
        ConnectionConfigurationHTTPError,
        ConnectionRevisionChangedHTTPError,
        ConnectionCheckUnavailableHTTPError,
        ConnectionSecretUnavailableHTTPError,
        ConnectionOAuthHTTPError,
        ConnectionReauthorizationHTTPError,
    )
    def post(self, connection_id: UUID):
        identity = _identity()
        with _errors():
            command = ConsumerReauthorizePayload.model_validate(console_ns.payload or {})
            result = application_services().consumer.reauthorize(
                identity,
                str(connection_id),
                connection_revision=command.connection_revision,
                callback_url=request.url_root.rstrip("/") + "/console/api/me/connections/oauth",
            )
        response = make_response(dump_response(ConsumerOAuthResponse, result))
        response.set_cookie(
            "context_id",
            result.context_id,
            httponly=True,
            samesite="Lax",
            secure=request.is_secure,
            max_age=OAuthProxyService.__MAX_AGE__,
        )
        response.headers["Cache-Control"] = "no-store"
        # response-contract:ignore cookie-bearing OAuth response
        return response


@console_ns.route("/me/connections/oauth/<path:provider>/callback")
class ConsumerOAuthCallbackApi(Resource):
    @console_ns.response(302, "Redirect to OAuth completion page")
    @error_responses(
        ConnectionConfigurationHTTPError,
        ConnectionConflictHTTPError,
        ConnectionNotFoundHTTPError,
        ConnectionOAuthHTTPError,
        ConnectionReauthorizationHTTPError,
        ConnectionSecretUnavailableHTTPError,
        ConnectionRevisionChangedHTTPError,
        ConnectionCheckUnavailableHTTPError,
    )
    def get(self, provider: str):
        # The existing one-use context cookie and Provider state admit this continuation.
        # response-contract:ignore cookie-bearing OAuth redirect
        return complete_end_user_connection_oauth(provider, request.cookies.get("context_id", ""))
