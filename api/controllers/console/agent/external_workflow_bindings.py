"""Atomic draft-only External binding change/recovery; no connection credentials."""

from dataclasses import asdict
from typing import Any
from uuid import UUID

from flask import request
from flask_restx import Resource
from pydantic import BaseModel, ConfigDict, Field

from controllers.common.schema import register_response_schema_models, register_schema_models
from controllers.console import console_ns
from controllers.console.agent.external import external_call
from controllers.console.flask_admission import console_account_admission
from extensions.ext_application_services import application_services
from fields.base import ResponseModel
from libs.helper import dump_response
from machinery.context import RequestContext


class ExternalWorkflowRebindPayload(BaseModel):
    model_config = ConfigDict(extra="forbid", hide_input_in_errors=True)
    target_agent_id: UUID
    expected_hash: str = Field(min_length=1, max_length=255)
    include_matching: bool = True


class ExternalWorkflowRebindResponse(ResponseModel):
    workflow_id: str
    hash: str
    node_ids: tuple[str, ...]
    binding_epochs: dict[str, str | None]


register_schema_models(console_ns, ExternalWorkflowRebindPayload)
register_response_schema_models(console_ns, ExternalWorkflowRebindResponse)


@console_ns.route("/apps/<uuid:app_id>/workflows/draft/external-agent-bindings/<string:node_id>/rebind")
class ExternalWorkflowRebindApi(Resource):
    @console_ns.expect(console_ns.models[ExternalWorkflowRebindPayload.__name__])
    @console_ns.response(200, "Committed binding set", console_ns.models[ExternalWorkflowRebindResponse.__name__])
    @console_account_admission()
    def post(self, context: RequestContext, app_id: UUID, node_id: str) -> Any:
        payload = ExternalWorkflowRebindPayload.model_validate(request.get_json())
        result = external_call(
            lambda: application_services().external_agents.bindings.rebind(
                context,
                app_id=str(app_id),
                node_id=node_id,
                target_agent_id=str(payload.target_agent_id),
                expected_hash=payload.expected_hash,
                include_matching=payload.include_matching,
            )
        )
        return dump_response(ExternalWorkflowRebindResponse, asdict(result))
