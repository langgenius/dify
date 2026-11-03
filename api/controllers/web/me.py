"""Account consumer APIs authenticated by the WebApp login cookie."""

from collections.abc import Generator
from contextlib import contextmanager
from datetime import datetime
from urllib.parse import urlsplit
from uuid import UUID

from flask import request
from flask_restx import Resource
from pydantic import BaseModel, ConfigDict, Field, ValidationError, field_serializer
from werkzeug.exceptions import Forbidden, NotFound, ServiceUnavailable, Unauthorized

from configs import dify_config
from controllers.common.end_user_connections import (
    ConnectionConflictHTTPError,
    ConnectionNotFoundHTTPError,
    raise_connection_error,
)
from controllers.common.schema import query_params_from_model, register_response_schema_models
from controllers.web import web_ns
from extensions.ext_application_services import application_services
from fields.base import ResponseModel
from libs.datetime_utils import to_utc_timestamp
from libs.external_api import error_responses
from libs.helper import dump_response
from libs.token import extract_webapp_cookie_token
from services.consumer_service import (
    ConsumerApp,
    ConsumerAppNotFoundError,
    ConsumerAppsQuery,
    ConsumerConnection,
    ConsumerIdentity,
)
from services.end_user_connections.contracts import ListConnectionsInput
from services.end_user_connections.errors import ConnectionError
from services.web_identity_service import WebIdentityError
from services.web_passport_service import WebPassportUnauthorizedError
from services.webapp_access_query_service import WebAppAccessUnavailableError


def _origin(url: str) -> tuple[str, str, int]:
    parsed = urlsplit(url)
    if (
        parsed.scheme not in {"http", "https"}
        or parsed.hostname is None
        or parsed.username is not None
        or parsed.password is not None
        or parsed.query
        or parsed.fragment
    ):
        raise ValueError("Invalid origin.")
    port = parsed.port
    return parsed.scheme, parsed.hostname, port if port is not None else (443 if parsed.scheme == "https" else 80)


def _identity() -> ConsumerIdentity:
    """Cookie authentication requires a trusted browser origin for account-wide mutations."""
    origin = request.headers.get("Origin")
    if origin is not None or request.method not in {"GET", "HEAD", "OPTIONS"}:
        try:
            trusted = next(
                url
                for url in (dify_config.APP_WEB_URL, dify_config.CONSOLE_WEB_URL, request.host_url)
                if urlsplit(url).netloc
            )
            if origin is None or _origin(origin) != _origin(trusted):
                raise ValueError("Untrusted origin.")
        except ValueError:
            raise Forbidden("WebApp request origin is not allowed.") from None
    try:
        return application_services().consumer.authenticate(extract_webapp_cookie_token(request))
    except (WebIdentityError, WebPassportUnauthorizedError):
        raise Unauthorized("WebApp Account login required.") from None


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


class ConsumerConnectionResponse(ConsumerConnection, ResponseModel):
    pass


class ConsumerConnectionsResponse(ResponseModel):
    data: list[ConsumerConnectionResponse]
    has_more: bool
    next_cursor: str | None


class ConsumerConnectionsQuery(ListConnectionsInput):
    limit: int = Field(default=20, ge=1, le=100, strict=False)


class ConsumerConnectionAppsQuery(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    cursor: UUID | None = None
    limit: int = Field(default=20, ge=1, le=100)


register_response_schema_models(
    web_ns,
    ConsumerAppResponse,
    ConsumerAppsResponse,
    ConsumerConnectionResponse,
    ConsumerConnectionsResponse,
)


@web_ns.route("/me/apps")
class ConsumerAppsApi(Resource):
    @web_ns.doc(
        description="List accessible Chatflow and Workflow Apps using the WebApp Account login cookie. "
        "Recent use is derived from retained published execution logs. "
        "No App Passport or workspace membership is required."
    )
    @web_ns.doc(params=query_params_from_model(ConsumerAppsQuery))
    @web_ns.response(200, "Accessible personal Apps", web_ns.models[ConsumerAppsResponse.__name__])
    def get(self):
        identity = _identity()
        with _errors():
            query = ConsumerAppsQuery.model_validate(request.args.to_dict(flat=True))
            result = application_services().consumer.list_apps(identity, query)
        return dump_response(ConsumerAppsResponse, result)


@web_ns.route("/me/apps/<uuid:app_id>/favorite")
class ConsumerFavoriteApi(Resource):
    @web_ns.response(204, "App favorited")
    def put(self, app_id: UUID):
        identity = _identity()
        with _errors():
            application_services().consumer.set_favorite(identity, str(app_id), enabled=True)
        return "", 204

    @web_ns.response(204, "App unfavorited")
    def delete(self, app_id: UUID):
        identity = _identity()
        with _errors():
            application_services().consumer.set_favorite(identity, str(app_id), enabled=False)
        return "", 204


@web_ns.route("/me/connections")
class ConsumerConnectionsApi(Resource):
    @web_ns.doc(
        description="List personal Connections grouped by Provider, account label and Connection type. "
        "Connections without an account label form individual groups. WebApp counts include only accessible Apps."
    )
    @web_ns.doc(params=query_params_from_model(ConsumerConnectionsQuery))
    @web_ns.response(200, "Account Connections", web_ns.models[ConsumerConnectionsResponse.__name__])
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


@web_ns.route("/me/connections/<string:connection_key>/apps")
class ConsumerConnectionAppsApi(Resource):
    @web_ns.doc(description="List accessible WebApps associated with a Connection group returned by /me/connections.")
    @web_ns.doc(params=query_params_from_model(ConsumerConnectionAppsQuery))
    @web_ns.response(200, "Associated WebApps", web_ns.models[ConsumerAppsResponse.__name__])
    @error_responses(ConnectionNotFoundHTTPError)
    def get(self, connection_key: str):
        identity = _identity()
        with _errors():
            query = ConsumerConnectionAppsQuery.model_validate(request.args.to_dict(flat=True))
            result = application_services().consumer.list_connection_apps(
                identity, connection_key, cursor=str(query.cursor) if query.cursor else None, limit=query.limit
            )
        return dump_response(ConsumerAppsResponse, result)


@web_ns.route("/me/connections/<string:connection_key>")
class ConsumerConnectionApi(Resource):
    @web_ns.response(204, "Connection group disconnected")
    @web_ns.doc(
        description="Disconnect all owned Connections matching a group key returned by /me/connections. "
        "Cookie-authenticated browser mutations require the configured WebApp Origin."
    )
    @error_responses(ConnectionNotFoundHTTPError, ConnectionConflictHTTPError)
    def delete(self, connection_key: str):
        identity = _identity()
        with _errors():
            application_services().consumer.delete_connection(identity, connection_key)
        return "", 204
