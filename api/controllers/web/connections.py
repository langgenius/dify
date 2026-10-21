"""Web management of personal API-key Connections."""

from datetime import datetime
from typing import Any, NoReturn
from uuid import UUID

from flask import request
from pydantic import ConfigDict, Field, JsonValue, ValidationError, field_serializer
from pydantic.json_schema import SkipJsonSchema
from werkzeug.exceptions import Unauthorized

from controllers.common.schema import query_params_from_model, register_response_schema_models, register_schema_models
from controllers.web import web_ns
from controllers.web.wraps import WebApiResource
from extensions.ext_application_services import application_services
from fields.base import ResponseModel
from libs.datetime_utils import to_utc_timestamp
from libs.exception import BaseHTTPException
from libs.external_api import error_responses
from libs.helper import dump_response
from models.model import App, EndUser
from services.end_user_connection_identity import connection_context_from_web_passport
from services.end_user_connections.contracts import (
    ConnectionCheckView,
    ConnectionSummary,
    CreateApiKeyConnectionInput,
    ListConnectionsInput,
    UpdateConnectionInput,
)
from services.end_user_connections.entities import WebConnectionContext
from services.end_user_connections.errors import (
    ConnectionCheckUnavailableError,
    ConnectionConfigurationError,
    ConnectionConflictError,
    ConnectionError,
    ConnectionIdentityError,
    ConnectionInvalidCredentialsError,
    ConnectionNotFoundError,
    ConnectionSecretUnavailableError,
    ConnectionWorkflowChangedError,
)


class EndUserConnectionCreatePayload(CreateApiKeyConnectionInput):
    pass


def _omit_schema_default(schema: dict[str, Any]) -> None:
    schema.pop("default", None)


class EndUserConnectionUpdatePayload(UpdateConnectionInput):
    model_config = ConfigDict(json_schema_extra={"minProperties": 1})

    name: str | SkipJsonSchema[None] = Field(
        default=None, min_length=1, max_length=100, json_schema_extra=_omit_schema_default
    )
    credentials: dict[str, JsonValue] | SkipJsonSchema[None] = Field(
        default=None, min_length=1, repr=False, json_schema_extra=_omit_schema_default
    )


class EndUserConnectionListQuery(ListConnectionsInput):
    limit: int = Field(default=20, ge=1, le=100, strict=False)


class EndUserConnectionResponse(ConnectionSummary, ResponseModel):
    @field_serializer("created_at", "updated_at", "last_active_at")
    def serialize_timestamp(self, value: datetime) -> int:
        return to_utc_timestamp(value)

    @field_serializer("expires_at")
    def serialize_expiration(self, value: datetime | None) -> int | None:
        return to_utc_timestamp(value) if value is not None else None


class EndUserConnectionListResponse(ResponseModel):
    data: list[EndUserConnectionResponse]
    has_more: bool
    next_cursor: str | None


class EndUserConnectionCheckResponse(ConnectionCheckView, ResponseModel):
    pass


class ConnectionLoginRequiredError(BaseHTTPException):
    code = 401
    error_code = "end_user_login_required"
    description = "Sign in to manage personal connections."


class ConnectionNotFoundHTTPError(BaseHTTPException):
    code = 404
    error_code = "connection_not_found"
    description = "Connection not found."


class ConnectionConfigurationHTTPError(BaseHTTPException):
    code = 400
    error_code = "connection_configuration_invalid"
    description = "The connection is not compatible with this tool configuration."


class ConnectionConflictHTTPError(BaseHTTPException):
    code = 409
    error_code = "connection_conflict"
    description = "Connection changed during the operation."


class ConnectionWorkflowChangedHTTPError(BaseHTTPException):
    code = 409
    error_code = "workflow_changed"
    description = "The workflow changed. Confirm the connection selection again."


class ConnectionCredentialsHTTPError(BaseHTTPException):
    code = 400
    error_code = "connection_credentials_invalid"
    description = "Invalid credentials for this provider."


class ConnectionCheckUnavailableHTTPError(BaseHTTPException):
    code = 503
    error_code = "credential_check_unavailable"
    description = "Credential validation is temporarily unavailable."


class ConnectionSecretUnavailableHTTPError(BaseHTTPException):
    code = 503
    error_code = "connection_credentials_unavailable"
    description = "Connection credentials are temporarily unavailable."


def _context(app: App, end_user: EndUser) -> WebConnectionContext:
    context = connection_context_from_web_passport(app=app, end_user=end_user)
    # SNP-976 owns the deployment-level anonymous-connection gate. Until then,
    # a browser Guest identity alone does not authorize personal credential APIs.
    if context.account_id is None:
        raise ConnectionLoginRequiredError()
    return context


def _raise_error(error: ConnectionError) -> NoReturn:
    if isinstance(error, ConnectionIdentityError):
        raise Unauthorized(str(error)) from None
    errors: dict[type[ConnectionError], type[BaseHTTPException]] = {
        ConnectionNotFoundError: ConnectionNotFoundHTTPError,
        ConnectionConfigurationError: ConnectionConfigurationHTTPError,
        ConnectionConflictError: ConnectionConflictHTTPError,
        ConnectionWorkflowChangedError: ConnectionWorkflowChangedHTTPError,
        ConnectionInvalidCredentialsError: ConnectionCredentialsHTTPError,
        ConnectionCheckUnavailableError: ConnectionCheckUnavailableHTTPError,
        ConnectionSecretUnavailableError: ConnectionSecretUnavailableHTTPError,
    }
    if exception := errors.get(type(error)):
        raise exception() from None
    raise error


register_schema_models(
    web_ns, EndUserConnectionCreatePayload, EndUserConnectionUpdatePayload, EndUserConnectionListQuery
)
register_response_schema_models(
    web_ns, EndUserConnectionResponse, EndUserConnectionListResponse, EndUserConnectionCheckResponse
)


@web_ns.route("/connections")
class EndUserConnectionListApi(WebApiResource):
    @web_ns.doc(params=query_params_from_model(EndUserConnectionListQuery))
    @web_ns.response(200, "Personal connections", web_ns.models[EndUserConnectionListResponse.__name__])
    @error_responses(ConnectionLoginRequiredError, ConnectionConfigurationHTTPError)
    def get(self, app_model: App, end_user: EndUser):
        try:
            context = _context(app_model, end_user)
            query = EndUserConnectionListQuery.model_validate(request.args.to_dict(flat=True))
            result = application_services().end_user_connections.list_connections(context, query)
        except ValidationError:
            raise ValueError("Invalid connection query.") from None
        except ConnectionError as error:
            _raise_error(error)
        return dump_response(EndUserConnectionListResponse, result)

    @web_ns.expect(web_ns.models[EndUserConnectionCreatePayload.__name__])
    @web_ns.response(201, "API-key connection created", web_ns.models[EndUserConnectionResponse.__name__])
    @error_responses(
        ConnectionLoginRequiredError,
        ConnectionConfigurationHTTPError,
        ConnectionWorkflowChangedHTTPError,
        ConnectionCredentialsHTTPError,
        ConnectionCheckUnavailableHTTPError,
        ConnectionSecretUnavailableHTTPError,
    )
    def post(self, app_model: App, end_user: EndUser):
        try:
            context = _context(app_model, end_user)
            payload = EndUserConnectionCreatePayload.model_validate(web_ns.payload or {})
            result = application_services().end_user_connections.create_api_key(context, payload)
        except ValidationError:
            raise ValueError("Invalid connection payload.") from None
        except ConnectionError as error:
            _raise_error(error)
        return dump_response(EndUserConnectionResponse, result), 201


@web_ns.route("/connections/<uuid:connection_id>")
class EndUserConnectionApi(WebApiResource):
    @web_ns.response(200, "Personal connection", web_ns.models[EndUserConnectionResponse.__name__])
    @error_responses(ConnectionLoginRequiredError, ConnectionConfigurationHTTPError, ConnectionNotFoundHTTPError)
    def get(self, app_model: App, end_user: EndUser, connection_id: UUID):
        try:
            context = _context(app_model, end_user)
            result = application_services().end_user_connections.get_connection(context, str(connection_id))
        except ConnectionError as error:
            _raise_error(error)
        return dump_response(EndUserConnectionResponse, result)

    @web_ns.expect(web_ns.models[EndUserConnectionUpdatePayload.__name__])
    @web_ns.response(200, "Connection updated", web_ns.models[EndUserConnectionResponse.__name__])
    @error_responses(
        ConnectionLoginRequiredError,
        ConnectionConfigurationHTTPError,
        ConnectionNotFoundHTTPError,
        ConnectionConflictHTTPError,
        ConnectionCredentialsHTTPError,
        ConnectionCheckUnavailableHTTPError,
        ConnectionSecretUnavailableHTTPError,
    )
    def patch(self, app_model: App, end_user: EndUser, connection_id: UUID):
        try:
            context = _context(app_model, end_user)
            payload = EndUserConnectionUpdatePayload.model_validate(web_ns.payload or {})
            result = application_services().end_user_connections.update_connection(context, str(connection_id), payload)
        except ValidationError:
            raise ValueError("Invalid connection payload.") from None
        except ConnectionError as error:
            _raise_error(error)
        return dump_response(EndUserConnectionResponse, result)

    @web_ns.response(204, "API-key connection deleted")
    @error_responses(
        ConnectionLoginRequiredError,
        ConnectionConfigurationHTTPError,
        ConnectionNotFoundHTTPError,
        ConnectionConflictHTTPError,
    )
    def delete(self, app_model: App, end_user: EndUser, connection_id: UUID):
        try:
            context = _context(app_model, end_user)
            application_services().end_user_connections.delete_connection(context, str(connection_id))
        except ConnectionError as error:
            _raise_error(error)
        return "", 204


@web_ns.route("/connections/<uuid:connection_id>/check")
class EndUserConnectionCheckApi(WebApiResource):
    @web_ns.response(200, "Credential check result", web_ns.models[EndUserConnectionCheckResponse.__name__])
    @error_responses(
        ConnectionLoginRequiredError,
        ConnectionConfigurationHTTPError,
        ConnectionNotFoundHTTPError,
        ConnectionConflictHTTPError,
        ConnectionCheckUnavailableHTTPError,
        ConnectionSecretUnavailableHTTPError,
    )
    def post(self, app_model: App, end_user: EndUser, connection_id: UUID):
        try:
            context = _context(app_model, end_user)
            result = application_services().end_user_connections.check_connection(context, str(connection_id))
        except ConnectionError as error:
            _raise_error(error)
        return dump_response(EndUserConnectionCheckResponse, result)
