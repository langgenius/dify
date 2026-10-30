"""Web management of personal API-key and OAuth Connections."""

from datetime import datetime
from uuid import UUID

from flask import request
from pydantic import Field, RootModel, ValidationError, field_serializer
from werkzeug.exceptions import NotFound

from controllers.common.end_user_connections import (
    ConnectionCheckUnavailableHTTPError,
    ConnectionConfigurationHTTPError,
    ConnectionConflictHTTPError,
    ConnectionCredentialsHTTPError,
    ConnectionLoginRequiredError,
    ConnectionNotFoundHTTPError,
    ConnectionReauthorizationHTTPError,
    ConnectionRevisionChangedHTTPError,
    ConnectionSecretUnavailableHTTPError,
    ConnectionUpdatePayload,
)
from controllers.common.end_user_connections import (
    raise_connection_error as _raise_error,
)
from controllers.common.schema import query_params_from_model, register_response_schema_models, register_schema_models
from controllers.web import web_ns
from controllers.web.wraps import WebApiResource
from core.entities.provider_entities import ProviderConfig
from extensions.ext_application_services import application_services
from fields.base import ResponseModel
from libs.datetime_utils import to_utc_timestamp
from libs.external_api import error_responses
from libs.helper import dump_response
from models.model import App, EndUser
from services.end_user_connection_identity import connection_context_from_web_passport
from services.end_user_connections.contracts import (
    ConnectionInput,
    ConnectionRevisionView,
    ConnectionSummary,
    ConnectionTargetInput,
    CreateApiKeyConnectionInput,
    ListConnectionsInput,
)
from services.end_user_connections.errors import ConnectionError
from services.end_user_connections.selections import SaveConnectionConfigurationInput
from services.errors.conversation import ConversationNotExistsError


class ConnectionConfigurationQuery(ConnectionInput):
    conversation_id: UUID | None = Field(
        default=None,
        strict=False,
        description=(
            "Existing Chatflow Conversation whose choices to read, including an empty set. "
            "Omit for App defaults when initializing a new conversation or plain Workflow."
        ),
    )


class EndUserConnectionResponse(ConnectionSummary, ResponseModel):
    @field_serializer("created_at", "updated_at", "last_active_at")
    def serialize_timestamp(self, value: datetime) -> int:
        return to_utc_timestamp(value)

    @field_serializer("expires_at")
    def serialize_expiration(self, value: datetime | None) -> int | None:
        return to_utc_timestamp(value) if value is not None else None


class ConnectionConfigurationResponse(ResponseModel):
    connections: dict[str, EndUserConnectionResponse | None] = Field(
        description=(
            "Saved Connection details keyed by authorization node ID, not a readiness result. "
            "Inaccessible Connection references are returned as null."
        )
    )
    reauthorization_required: bool = Field(
        description=(
            "Whether this App user must renew authorization for the current requirements; not credential readiness."
        )
    )


class ConnectionConfigurationPayload(SaveConnectionConfigurationInput):
    pass


register_schema_models(web_ns, ConnectionConfigurationPayload)
register_response_schema_models(web_ns, ConnectionConfigurationResponse)


@web_ns.route("/connections/configuration")
class ConnectionConfigurationApi(WebApiResource):
    @web_ns.doc(params=query_params_from_model(ConnectionConfigurationQuery))
    @web_ns.doc(
        description="Read saved choices and whether authorization must be renewed, without checking credentials."
    )
    @web_ns.response(200, "Saved Connection configuration", web_ns.models[ConnectionConfigurationResponse.__name__])
    @error_responses(ConnectionConfigurationHTTPError, ConnectionCheckUnavailableHTTPError)
    def get(self, app_model: App, end_user: EndUser):
        try:
            context = connection_context_from_web_passport(app=app_model, end_user=end_user)
            query = ConnectionConfigurationQuery.model_validate(request.args.to_dict(flat=True))
            result = application_services().connection_selections.get(
                context, str(query.conversation_id) if query.conversation_id is not None else None
            )
        except ValidationError:
            raise ValueError("Invalid connection configuration query.") from None
        except ConversationNotExistsError:
            raise NotFound("Conversation Not Exists.") from None
        except ConnectionError as error:
            _raise_error(error)
        return dump_response(ConnectionConfigurationResponse, result)

    @web_ns.expect(web_ns.models[ConnectionConfigurationPayload.__name__])
    @web_ns.doc(description="Replace saved choices and explicitly approve their authorization contract atomically.")
    @web_ns.response(200, "Connection configuration saved", web_ns.models[ConnectionConfigurationResponse.__name__])
    @error_responses(
        ConnectionLoginRequiredError,
        ConnectionConfigurationHTTPError,
        ConnectionNotFoundHTTPError,
        ConnectionConflictHTTPError,
        ConnectionRevisionChangedHTTPError,
        ConnectionReauthorizationHTTPError,
        ConnectionCheckUnavailableHTTPError,
    )
    def put(self, app_model: App, end_user: EndUser):
        try:
            context = connection_context_from_web_passport(app=app_model, end_user=end_user)
            payload = ConnectionConfigurationPayload.model_validate(web_ns.payload or {})
            result = application_services().connection_selections.save(context, payload)
        except ValidationError:
            raise ValueError("Invalid connection configuration payload.") from None
        except ConversationNotExistsError:
            raise NotFound("Conversation Not Exists.") from None
        except ConnectionError as error:
            _raise_error(error)
        return dump_response(ConnectionConfigurationResponse, result)


class EndUserConnectionCreatePayload(CreateApiKeyConnectionInput):
    pass


class EndUserConnectionUpdatePayload(ConnectionUpdatePayload):
    pass


class EndUserConnectionRevisionResponse(ConnectionRevisionView, ResponseModel):
    pass


class ConnectionCredentialSchemaQuery(ConnectionTargetInput):
    pass


class ConnectionCredentialSchemaResponse(RootModel[list[ProviderConfig]]):
    pass


class EndUserConnectionListQuery(ListConnectionsInput):
    limit: int = Field(default=20, ge=1, le=100, strict=False)


class EndUserConnectionListResponse(ResponseModel):
    data: list[EndUserConnectionResponse]
    has_more: bool
    next_cursor: str | None


register_schema_models(
    web_ns,
    EndUserConnectionCreatePayload,
    EndUserConnectionUpdatePayload,
    EndUserConnectionListQuery,
)
register_response_schema_models(
    web_ns,
    EndUserConnectionResponse,
    EndUserConnectionListResponse,
    EndUserConnectionRevisionResponse,
    ConnectionCredentialSchemaResponse,
)


@web_ns.route("/connections/credential-schema")
class ConnectionCredentialSchemaApi(WebApiResource):
    @web_ns.doc(params=query_params_from_model(ConnectionCredentialSchemaQuery))
    @web_ns.doc(description="Read API-key form fields for an authorized published tool node; no credential values.")
    @web_ns.response(200, "API-key form schema", web_ns.models[ConnectionCredentialSchemaResponse.__name__])
    @error_responses(
        ConnectionLoginRequiredError,
        ConnectionConfigurationHTTPError,
        ConnectionRevisionChangedHTTPError,
        ConnectionCheckUnavailableHTTPError,
    )
    def get(self, app_model: App, end_user: EndUser):
        try:
            context = connection_context_from_web_passport(app=app_model, end_user=end_user)
            query = ConnectionCredentialSchemaQuery.model_validate(request.args.to_dict(flat=True))
            result = application_services().end_user_connections.get_api_key_schema(context, query)
        except ValidationError:
            raise ValueError("Invalid connection schema query.") from None
        except ConnectionError as error:
            _raise_error(error)
        return dump_response(ConnectionCredentialSchemaResponse, result), 200, {"Cache-Control": "no-store"}


@web_ns.route("/connections")
class EndUserConnectionListApi(WebApiResource):
    @web_ns.doc(params=query_params_from_model(EndUserConnectionListQuery))
    @web_ns.response(200, "Personal connections", web_ns.models[EndUserConnectionListResponse.__name__])
    @error_responses(ConnectionLoginRequiredError, ConnectionConfigurationHTTPError)
    def get(self, app_model: App, end_user: EndUser):
        try:
            context = connection_context_from_web_passport(app=app_model, end_user=end_user)
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
        ConnectionRevisionChangedHTTPError,
        ConnectionCredentialsHTTPError,
        ConnectionCheckUnavailableHTTPError,
        ConnectionSecretUnavailableHTTPError,
    )
    def post(self, app_model: App, end_user: EndUser):
        try:
            context = connection_context_from_web_passport(app=app_model, end_user=end_user)
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
            context = connection_context_from_web_passport(app=app_model, end_user=end_user)
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
        ConnectionRevisionChangedHTTPError,
        ConnectionCredentialsHTTPError,
        ConnectionCheckUnavailableHTTPError,
        ConnectionSecretUnavailableHTTPError,
    )
    def patch(self, app_model: App, end_user: EndUser, connection_id: UUID):
        try:
            context = connection_context_from_web_passport(app=app_model, end_user=end_user)
            payload = EndUserConnectionUpdatePayload.model_validate(web_ns.payload or {})
            result = application_services().end_user_connections.update_connection(context, str(connection_id), payload)
        except ValidationError:
            raise ValueError("Invalid connection payload.") from None
        except ConnectionError as error:
            _raise_error(error)
        return dump_response(EndUserConnectionResponse, result)

    @web_ns.doc(
        description=(
            "Disconnect locally and remove live selections, then attempt OAuth revocation against the original "
            "plugin artifact and Client. Remote failures never undo local deletion or fall back to installed versions."
        )
    )
    @web_ns.response(204, "Connection deleted")
    @error_responses(
        ConnectionLoginRequiredError,
        ConnectionConfigurationHTTPError,
        ConnectionNotFoundHTTPError,
        ConnectionConflictHTTPError,
    )
    def delete(self, app_model: App, end_user: EndUser, connection_id: UUID):
        try:
            context = connection_context_from_web_passport(app=app_model, end_user=end_user)
            application_services().end_user_connections.delete_connection(context, str(connection_id))
        except ConnectionError as error:
            _raise_error(error)
        return "", 204


@web_ns.route("/connections/<uuid:connection_id>/revision")
class EndUserConnectionRevisionApi(WebApiResource):
    @web_ns.response(200, "Current Provider revision", web_ns.models[EndUserConnectionRevisionResponse.__name__])
    @web_ns.doc(description="Read a Provider revision for an owned Connection, independently of published tool nodes.")
    @error_responses(
        ConnectionLoginRequiredError,
        ConnectionNotFoundHTTPError,
        ConnectionConfigurationHTTPError,
        ConnectionCheckUnavailableHTTPError,
    )
    def get(self, app_model: App, end_user: EndUser, connection_id: UUID):
        try:
            result = application_services().end_user_connections.get_connection_revision(
                connection_context_from_web_passport(app=app_model, end_user=end_user), str(connection_id)
            )
        except ConnectionError as error:
            _raise_error(error)
        return dump_response(EndUserConnectionRevisionResponse, result), 200, {"Cache-Control": "no-store"}
