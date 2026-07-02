"""Inner API endpoint for Agent core tool invocation."""

from flask_restx import Resource
from pydantic import ValidationError

from controllers.common.schema import register_response_schema_models, register_schema_models
from controllers.inner_api import inner_api_ns
from controllers.inner_api.wraps import agent_inner_api_only
from extensions.ext_database import db
from libs.exception import BaseHTTPException
from services.agent_tool_inner_service import AgentToolInnerService
from services.entities.agent_tool_inner import AgentToolInvokeRequest, AgentToolInvokeResponse
from services.errors.agent_tool_inner import AgentToolInnerServiceError

from sqlalchemy.orm import Session
from controllers.console.app.wraps import with_session


class AgentToolInvokeHttpError(BaseHTTPException):
    error_code = "agent_tool_invoke_failed"
    description = "Agent tool invocation failed."
    code = 500

    def __init__(
        self,
        *,
        error_code: str | None = None,
        description: str | None = None,
        status_code: int | None = None,
    ) -> None:
        if error_code is not None:
            self.error_code = error_code
        if description is not None:
            self.description = description
        if status_code is not None:
            self.code = status_code
        super().__init__(self.description)


register_schema_models(inner_api_ns, AgentToolInvokeRequest)
register_response_schema_models(inner_api_ns, AgentToolInvokeResponse)


@inner_api_ns.route("/agent/tools/invoke")
class AgentToolInvokeApi(Resource):
    """Invoke one Agent tool through the API-owned core tool runtime path."""

    @agent_inner_api_only
    @inner_api_ns.doc("inner_agent_tool_invoke")
    @inner_api_ns.expect(inner_api_ns.models[AgentToolInvokeRequest.__name__])
    @inner_api_ns.response(200, "Tool invoked successfully", inner_api_ns.models[AgentToolInvokeResponse.__name__])
    @with_session
    def post(self, session: Session) -> dict[str, object]:
        try:
            payload = AgentToolInvokeRequest.model_validate(inner_api_ns.payload or {})
        except ValidationError as exc:
            raise AgentToolInvokeHttpError(
                error_code="invalid_request",
                description=str(exc),
                status_code=400,
            ) from exc

        try:
            response = AgentToolInnerService().invoke(session=session, request=payload)
        except AgentToolInnerServiceError as exc:
            raise AgentToolInvokeHttpError(
                error_code=exc.error_code,
                description=exc.description,
                status_code=exc.status_code,
            ) from exc

        return response.model_dump(mode="json")
