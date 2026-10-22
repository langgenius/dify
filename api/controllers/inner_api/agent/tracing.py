"""Authenticated, idempotent ingestion of Agent observations."""

from typing import Literal
from uuid import UUID

from dify_agent.protocol.tracing import AgentTraceBatch
from flask import request
from flask_restx import Resource
from pydantic import ValidationError
from werkzeug.exceptions import BadRequest, Conflict, NotFound, RequestEntityTooLarge

from configs import dify_config
from controllers.common.schema import register_response_schema_models, register_schema_models
from controllers.inner_api import inner_api_ns
from controllers.inner_api.wraps import agent_inner_api_only
from fields.base import ResponseModel
from repositories.application_trace_repository import TraceCollectionError
from services.tracing.service import application_tracing_service


class AgentTraceBatchResponse(ResponseModel):
    result: Literal["success"]
    batch_id: UUID
    accepted_spans: int


register_schema_models(inner_api_ns, AgentTraceBatch)
register_response_schema_models(inner_api_ns, AgentTraceBatchResponse)


@inner_api_ns.route("/agent/tracing/batches")
class AgentTraceBatchesApi(Resource):
    @agent_inner_api_only
    @inner_api_ns.doc("inner_agent_trace_batches")
    @inner_api_ns.expect(inner_api_ns.models[AgentTraceBatch.__name__])
    @inner_api_ns.response(200, "Durably accepted", inner_api_ns.models[AgentTraceBatchResponse.__name__])
    def post(self):
        request.max_content_length = dify_config.OPS_AGENT_TRACE_BATCH_MAX_BYTES
        try:
            payload = AgentTraceBatch.model_validate(inner_api_ns.payload or {})
            accepted = application_tracing_service().ingest(payload)
        except ValidationError as error:
            raise BadRequest("Invalid Agent trace batch") from error
        except TraceCollectionError as error:
            error_type = {404: NotFound, 409: Conflict, 413: RequestEntityTooLarge}.get(error.status, BadRequest)
            raise error_type(error.code) from error
        return AgentTraceBatchResponse(result="success", batch_id=payload.batch_id, accepted_spans=accepted).model_dump(
            mode="json"
        )
