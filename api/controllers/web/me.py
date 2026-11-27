"""Account consumer APIs authenticated by the WebApp login cookie."""

from collections.abc import Generator
from contextlib import contextmanager
from datetime import datetime
from uuid import UUID

from flask import request
from flask_restx import Resource
from pydantic import BaseModel, ConfigDict, Field, ValidationError, field_serializer
from werkzeug.exceptions import NotFound, ServiceUnavailable

from controllers.common.end_user_connections import (
    ConnectionConflictHTTPError,
    ConnectionNotFoundHTTPError,
    raise_connection_error,
)
from controllers.common.schema import query_params_from_model, register_response_schema_models
from controllers.web import web_ns
from controllers.web.account_admission import web_account_identity as _identity
from extensions.ext_application_services import application_services
from fields.base import ResponseModel
from libs.datetime_utils import to_utc_timestamp
from libs.external_api import error_responses
from libs.helper import dump_response
from services.consumer_service import (
    ConsumerApp,
    ConsumerAppNotFoundError,
    ConsumerAppsQuery,
    ConsumerConnection,
    ConsumerConnectionProvider,
)
from services.end_user_connection_labels import mask_account_label
from services.end_user_connections.errors import ConnectionError
from services.webapp_access_query_service import WebAppAccessUnavailableError


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
    @field_serializer("account_label")
    def serialize_account_label(self, value: str | None) -> str | None:
        """Mask the persisted provider identity in the Consumer API."""
        return mask_account_label(value)


class ConsumerConnectionsResponse(ResponseModel):
    data: list[ConsumerConnectionResponse]
    has_more: bool
    next_cursor: str | None


class ConsumerConnectionProviderResponse(ConsumerConnectionProvider, ResponseModel):
    pass


class ConsumerConnectionProvidersResponse(ResponseModel):
    data: list[ConsumerConnectionProviderResponse]
    has_more: bool
    next_cursor: str | None


class ConsumerConnectionProvidersQuery(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    cursor: str | None = Field(default=None, min_length=1, max_length=255)
    limit: int = Field(default=20, ge=1, le=100)


class ConsumerConnectionsQuery(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    cursor: str | None = Field(default=None, min_length=1, max_length=2048)
    limit: int = Field(default=20, ge=1, le=100)


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
    ConsumerConnectionProviderResponse,
    ConsumerConnectionProvidersResponse,
)


@web_ns.route("/me/apps")
class ConsumerAppsApi(Resource):
    @web_ns.doc(
        description="List accessible Chat, Completion, legacy Agent, Chatflow, Workflow and Agent WebApps "
        "using the WebApp Account login cookie. "
        "Recent use and favorites are personal WebApp preferences independent of Console stars. "
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


@web_ns.route("/me/apps/<uuid:app_id>")
class ConsumerAppApi(Resource):
    @web_ns.doc(
        description="Remove an App from personal recent and favorite lists without deleting its data. "
        "A new accepted execution restores the recent entry. Shared discovery remains available."
    )
    @web_ns.response(204, "App removed from personal lists")
    def delete(self, app_id: UUID):
        identity = _identity()
        with _errors():
            application_services().consumer.remove_app(identity, str(app_id))
        return "", 204


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
class ConsumerConnectionProvidersApi(Resource):
    @web_ns.doc(
        description="List personal Connection Providers with localized labels, descriptions, public icons and "
        "Connection-group counts across owned tenants. Guests are excluded. Unavailable Providers retain their "
        "counts with a Provider-ID label, an empty description and null icons. No App associations are loaded."
    )
    @web_ns.doc(params=query_params_from_model(ConsumerConnectionProvidersQuery))
    @web_ns.response(200, "Account Connection Providers", web_ns.models[ConsumerConnectionProvidersResponse.__name__])
    def get(self):
        identity = _identity()
        with _errors():
            query = ConsumerConnectionProvidersQuery.model_validate(request.args.to_dict(flat=True))
            result = application_services().consumer.list_connection_providers(
                identity, cursor=query.cursor, limit=query.limit
            )
        return dump_response(ConsumerConnectionProvidersResponse, result)


@web_ns.route("/me/connections/providers/<path:provider>/connections")
class ConsumerConnectionsApi(Resource):
    @web_ns.doc(
        description="List personal Connections grouped by Provider, account label and Connection type. "
        "Connections without an account label form individual groups. WebApp counts include only accessible Apps."
    )
    @web_ns.doc(params=query_params_from_model(ConsumerConnectionsQuery))
    @web_ns.response(200, "Account Connections", web_ns.models[ConsumerConnectionsResponse.__name__])
    def get(self, provider: str):
        identity = _identity()
        with _errors():
            query = ConsumerConnectionsQuery.model_validate(request.args.to_dict(flat=True))
            result = application_services().consumer.list_connections(
                identity,
                provider=provider,
                cursor=query.cursor,
                limit=query.limit,
            )
        return dump_response(ConsumerConnectionsResponse, result)


@web_ns.route("/me/connections/<uuid:connection_key>/apps")
class ConsumerConnectionAppsApi(Resource):
    @web_ns.doc(description="List accessible WebApps associated with a Connection group from a Provider's list.")
    @web_ns.doc(params=query_params_from_model(ConsumerConnectionAppsQuery))
    @web_ns.response(200, "Associated WebApps", web_ns.models[ConsumerAppsResponse.__name__])
    @error_responses(ConnectionNotFoundHTTPError)
    def get(self, connection_key: UUID):
        identity = _identity()
        with _errors():
            query = ConsumerConnectionAppsQuery.model_validate(request.args.to_dict(flat=True))
            result = application_services().consumer.list_connection_apps(
                identity, connection_key, cursor=str(query.cursor) if query.cursor else None, limit=query.limit
            )
        return dump_response(ConsumerAppsResponse, result)


@web_ns.route("/me/connections/<uuid:connection_key>")
class ConsumerConnectionApi(Resource):
    @web_ns.response(204, "Connection group disconnected")
    @web_ns.doc(
        description="Disconnect all owned Connections matching a group key from a Provider's list. "
        "Cookie-authenticated browser mutations require the configured WebApp Origin."
    )
    @error_responses(ConnectionNotFoundHTTPError, ConnectionConflictHTTPError)
    def delete(self, connection_key: UUID):
        identity = _identity()
        with _errors():
            application_services().consumer.delete_connection(identity, connection_key)
        return "", 204
