"""Inspect explicit connection selections before a Web App run."""

from pydantic import ValidationError
from werkzeug.exceptions import NotFound

from controllers.common.end_user_connections import (
    ConnectionCheckUnavailableHTTPError,
    ConnectionConfigurationHTTPError,
    ConnectionConflictHTTPError,
    ConnectionReauthorizationHTTPError,
    ConnectionSecretUnavailableHTTPError,
    ConnectionWorkflowChangedHTTPError,
    raise_connection_error,
)
from controllers.common.schema import register_response_schema_models, register_schema_models
from controllers.web import web_ns
from controllers.web.wraps import WebApiResource
from extensions.ext_application_services import application_services
from fields.base import ResponseModel
from libs.external_api import error_responses
from libs.helper import dump_response
from models.model import App, EndUser
from services.end_user_connection_identity import connection_context_from_web_passport
from services.end_user_connections.errors import ConnectionError
from services.end_user_connections.preflight import ConnectionPreflightInput, ConnectionPreflightView
from services.errors.conversation import ConversationNotExistsError


class EndUserConnectionPreflightPayload(ConnectionPreflightInput):
    pass


class EndUserConnectionPreflightResponse(ConnectionPreflightView, ResponseModel):
    pass


register_schema_models(web_ns, EndUserConnectionPreflightPayload)
register_response_schema_models(web_ns, EndUserConnectionPreflightResponse)


@web_ns.route("/connections/preflight")
class EndUserConnectionPreflightApi(WebApiResource):
    @web_ns.expect(web_ns.models[EndUserConnectionPreflightPayload.__name__])
    @web_ns.response(
        200,
        "Explicit connection requirements and readiness",
        web_ns.models[EndUserConnectionPreflightResponse.__name__],
    )
    @error_responses(
        ConnectionConfigurationHTTPError,
        ConnectionConflictHTTPError,
        ConnectionWorkflowChangedHTTPError,
        ConnectionReauthorizationHTTPError,
        ConnectionCheckUnavailableHTTPError,
        ConnectionSecretUnavailableHTTPError,
    )
    def post(self, app_model: App, end_user: EndUser):
        try:
            context = connection_context_from_web_passport(app=app_model, end_user=end_user)
            payload = EndUserConnectionPreflightPayload.model_validate(web_ns.payload or {})
            result = application_services().end_user_connection_preflight.check(context, payload)
        except ValidationError:
            raise ValueError("Invalid connection preflight payload.") from None
        except ConversationNotExistsError:
            raise NotFound("Conversation Not Exists.") from None
        except ConnectionError as error:
            raise_connection_error(error)
        return dump_response(EndUserConnectionPreflightResponse, result)
