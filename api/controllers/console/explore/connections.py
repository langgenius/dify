"""Web-compatible Connection operations over member-visible Workspace credentials."""

from collections.abc import Callable
from functools import wraps
from uuid import UUID

from flask import request
from flask_restx import Resource
from pydantic import BaseModel, ConfigDict, Field

from context.connection_execution import WorkspaceConnectionScope
from controllers.common.connection_fields import ConnectionConfigurationResponse, EndUserConnectionListResponse
from controllers.common.end_user_connections import (
    ConnectionCheckUnavailableHTTPError,
    ConnectionConfigurationHTTPError,
    ConnectionConflictHTTPError,
    ConnectionCredentialsHTTPError,
    ConnectionNotFoundHTTPError,
    ConnectionReauthorizationHTTPError,
    ConnectionRequiredHTTPError,
    ConnectionRevisionChangedHTTPError,
    raise_connection_error,
)
from controllers.common.errors import NotFoundError
from controllers.common.schema import query_params_from_model, register_response_schema_models, register_schema_models
from controllers.console import console_ns
from controllers.console.explore.installed_app_admission import get_installed_app
from controllers.console.flask_admission import console_account_admission
from extensions.ext_application_services import application_services
from fields.base import ResponseModel
from libs.external_api import document_errors
from libs.helper import dump_response
from machinery.context import RequestContext
from services.end_user_connections.contracts import ListConnectionsInput
from services.end_user_connections.errors import ConnectionError
from services.end_user_connections.preflight import ConnectionPreflightInput, ConnectionPreflightView
from services.end_user_connections.selections import SaveConnectionConfigurationInput
from services.errors.conversation import ConversationNotExistsError
from services.installed_app_access_service import InstalledAppRef
from services.workflow_test_credentials import TestCredentialError


def installed_connection_errors[**Parameters, Result](
    view: Callable[Parameters, Result],
) -> Callable[Parameters, Result]:
    @wraps(view)
    def wrapped(*args: Parameters.args, **kwargs: Parameters.kwargs) -> Result:
        try:
            return view(*args, **kwargs)
        except ConnectionError as error:
            raise_connection_error(error)
        except ConversationNotExistsError:
            raise NotFoundError("Conversation Not Exists.") from None
        except TestCredentialError:
            raise ConnectionConfigurationHTTPError() from None

    return document_errors(
        wrapped,
        ConnectionConfigurationHTTPError,
        ConnectionNotFoundHTTPError,
        ConnectionConflictHTTPError,
        ConnectionRevisionChangedHTTPError,
        ConnectionCheckUnavailableHTTPError,
        ConnectionCredentialsHTTPError,
        ConnectionReauthorizationHTTPError,
        ConnectionRequiredHTTPError,
    )


def _scope(context: RequestContext, installation: InstalledAppRef) -> WorkspaceConnectionScope:
    return WorkspaceConnectionScope(
        installed_app_id=installation.id, tenant_id=installation.tenant_id, account_id=context.account_id
    )


class InstalledConnectionListQuery(ListConnectionsInput):
    limit: int = Field(default=20, ge=1, le=100, strict=False)


class InstalledConnectionConfigurationQuery(BaseModel):
    model_config = ConfigDict(extra="forbid")
    conversation_id: UUID | None = None


class InstalledConnectionPreflightPayload(ConnectionPreflightInput):
    pass


class InstalledConnectionConfigurationPayload(SaveConnectionConfigurationInput):
    pass


class InstalledConnectionPreflightResponse(ConnectionPreflightView, ResponseModel):
    pass


register_schema_models(console_ns, InstalledConnectionPreflightPayload, InstalledConnectionConfigurationPayload)
register_response_schema_models(
    console_ns,
    EndUserConnectionListResponse,
    ConnectionConfigurationResponse,
    InstalledConnectionPreflightResponse,
)


@console_ns.route("/installed-apps/<uuid:installed_app_id>/connections")
class InstalledConnectionsApi(Resource):
    @console_ns.doc(
        description="List member-visible Workspace credentials for published End User requirements. "
        "IDs refer to Workspace credentials, not personal Connections. No secrets are read. "
        "credential_status and last_active_at are null when no persisted lifecycle or activity metadata is available."
    )
    @console_ns.doc(params=query_params_from_model(InstalledConnectionListQuery))
    @console_ns.response(
        200, "Visible Workspace Connections", console_ns.models[EndUserConnectionListResponse.__name__]
    )
    @console_account_admission()
    @get_installed_app
    @installed_connection_errors
    def get(self, request_context: RequestContext, installed_app: InstalledAppRef):
        query = InstalledConnectionListQuery.model_validate(request.args.to_dict(flat=True))
        result = application_services().installed_apps.connections.list_connections(
            _scope(request_context, installed_app), provider=query.provider, cursor=query.cursor, limit=query.limit
        )
        return dump_response(EndUserConnectionListResponse, result)


@console_ns.route("/installed-apps/<uuid:installed_app_id>/connections/configuration")
class InstalledConnectionConfigurationApi(Resource):
    @console_ns.doc(
        description="Read this Tenant Member's saved App defaults, or an owned Chatflow conversation's "
        "choices, without credential checks. Missing conversation choices do not inherit current App defaults."
    )
    @console_ns.doc(params=query_params_from_model(InstalledConnectionConfigurationQuery))
    @console_ns.response(200, "Saved member choices", console_ns.models[ConnectionConfigurationResponse.__name__])
    @console_account_admission()
    @get_installed_app
    @installed_connection_errors
    def get(self, request_context: RequestContext, installed_app: InstalledAppRef):
        query = InstalledConnectionConfigurationQuery.model_validate(request.args.to_dict(flat=True))
        result = application_services().installed_apps.connections.configuration(
            _scope(request_context, installed_app), str(query.conversation_id) if query.conversation_id else None
        )
        return dump_response(ConnectionConfigurationResponse, result)

    @console_ns.expect(console_ns.models[InstalledConnectionConfigurationPayload.__name__])
    @console_ns.doc(
        description="Replace member App defaults or owned conversation choices and confirm the current "
        "authorization requirements. An empty map clears choices; this does not modify Workspace credentials."
    )
    @console_ns.response(200, "Member choices saved", console_ns.models[ConnectionConfigurationResponse.__name__])
    @console_account_admission()
    @get_installed_app
    @installed_connection_errors
    def put(self, request_context: RequestContext, installed_app: InstalledAppRef):
        command = InstalledConnectionConfigurationPayload.model_validate(console_ns.payload or {})
        result = application_services().installed_apps.connections.save_configuration(
            _scope(request_context, installed_app), command
        )
        return dump_response(ConnectionConfigurationResponse, result)


@console_ns.route("/installed-apps/<uuid:installed_app_id>/connections/preflight")
class InstalledConnectionPreflightApi(Resource):
    @console_ns.doc(
        description="Check explicit Workspace credential choices without saving them or starting a Run. "
        "Workspace OAuth credentials may be refreshed. Run entry and node execution recheck access independently."
    )
    @console_ns.expect(console_ns.models[InstalledConnectionPreflightPayload.__name__])
    @console_ns.response(200, "Connection readiness", console_ns.models[InstalledConnectionPreflightResponse.__name__])
    @console_account_admission()
    @get_installed_app
    @installed_connection_errors
    def post(self, request_context: RequestContext, installed_app: InstalledAppRef):
        command = InstalledConnectionPreflightPayload.model_validate(console_ns.payload or {})
        result = application_services().installed_apps.connections.preflight(
            _scope(request_context, installed_app), command
        )
        return dump_response(InstalledConnectionPreflightResponse, result)
