"""Authenticated service-only native effect control; human decisions live in C04."""

from dify_agent.adapters.native_testing.client import (
    AgentBeforeCallPayload,
    AgentMaterialization,
    AgentMaterializePayload,
    AgentOutcomePayload,
    AgentPhysicalDispatchPayload,
)
from dify_agent.protocol.native_testing import AgentEffectDecision, AgentEffectReceipt
from flask import request
from flask_restx import Resource
from pydantic import RootModel, ValidationError

from controllers.common.schema import register_response_schema_models, register_schema_models
from controllers.inner_api import inner_api_ns
from controllers.inner_api.wraps import agent_inner_api_only
from fields.base import ResponseModel
from libs.exception import BaseHTTPException
from libs.external_api import error_responses
from libs.helper import dump_response
from services.dify_builder.execution_contracts import BuilderExecutionPolicyError
from services.dify_builder.native_testing.agent_bridge import agent_bridge_for_ref, api_intent, api_permit, api_ref


class AgentBeforeCallResponse(RootModel[AgentEffectDecision]):
    """Preserve the exact discriminated C01 decision on the independent wire."""


class AgentOutcomeResponse(AgentEffectReceipt, ResponseModel):
    pass


class AgentMaterializeResponse(AgentMaterialization, ResponseModel):
    pass


class AgentDispatchClaimResponse(ResponseModel):
    claimed: bool


class AgentNativeControlRefused(BaseHTTPException):
    error_code = "native_agent_control_refused"
    description = "Native Agent control is unavailable."
    code = 409


def _parse(model):
    request.max_content_length = 1024 * 1024
    try:
        return model.model_validate(inner_api_ns.payload or {})
    except ValidationError:
        raise ValueError("Invalid native Agent control payload") from None


register_schema_models(
    inner_api_ns, AgentBeforeCallPayload, AgentOutcomePayload, AgentMaterializePayload, AgentPhysicalDispatchPayload
)
register_response_schema_models(
    inner_api_ns, AgentBeforeCallResponse, AgentOutcomeResponse, AgentMaterializeResponse, AgentDispatchClaimResponse
)


@inner_api_ns.route("/agent/native-testing/before-call")
class AgentNativeBeforeCallApi(Resource):
    @agent_inner_api_only
    @inner_api_ns.expect(inner_api_ns.models[AgentBeforeCallPayload.__name__])
    @inner_api_ns.response(200, "Native effect decision", inner_api_ns.models[AgentBeforeCallResponse.__name__])
    @error_responses(AgentNativeControlRefused)
    def post(self):
        payload = _parse(AgentBeforeCallPayload)
        try:
            result = agent_bridge_for_ref(payload.ref).before_call(ref=payload.ref, intent=payload.intent)
        except BuilderExecutionPolicyError:
            raise AgentNativeControlRefused() from None
        return dump_response(AgentBeforeCallResponse, result)


@inner_api_ns.route("/agent/native-testing/outcome")
class AgentNativeOutcomeApi(Resource):
    @agent_inner_api_only
    @inner_api_ns.expect(inner_api_ns.models[AgentOutcomePayload.__name__])
    @inner_api_ns.response(200, "Effect outcome recorded", inner_api_ns.models[AgentOutcomeResponse.__name__])
    @error_responses(AgentNativeControlRefused)
    def post(self):
        payload = _parse(AgentOutcomePayload)
        try:
            result = agent_bridge_for_ref(payload.ref).record_outcome(
                ref=payload.ref, permit=payload.permit, outcome=payload.outcome, result_ref=payload.result_ref
            )
        except BuilderExecutionPolicyError:
            raise AgentNativeControlRefused() from None
        return dump_response(AgentOutcomeResponse, result)


@inner_api_ns.route("/agent/native-testing/materialize")
class AgentNativeMaterializeApi(Resource):
    @agent_inner_api_only
    @inner_api_ns.expect(inner_api_ns.models[AgentMaterializePayload.__name__])
    @inner_api_ns.response(
        200, "Operation-local materialization", inner_api_ns.models[AgentMaterializeResponse.__name__]
    )
    @error_responses(AgentNativeControlRefused)
    def post(self):
        payload = _parse(AgentMaterializePayload)
        try:
            result = agent_bridge_for_ref(payload.ref).materialize(
                ref=payload.ref,
                intent=payload.intent,
                permit=payload.permit,
                tool_ref=payload.tool_ref,
                phase=payload.phase,
            )
        except BuilderExecutionPolicyError:
            raise AgentNativeControlRefused() from None
        return dump_response(AgentMaterializeResponse, result)


@inner_api_ns.route("/agent/native-testing/claim-dispatch")
class AgentNativeDispatchClaimApi(Resource):
    @agent_inner_api_only
    @inner_api_ns.expect(inner_api_ns.models[AgentPhysicalDispatchPayload.__name__])
    @inner_api_ns.response(200, "Physical dispatch claimed", inner_api_ns.models[AgentDispatchClaimResponse.__name__])
    @error_responses(AgentNativeControlRefused)
    def post(self):
        payload = _parse(AgentPhysicalDispatchPayload)
        try:
            if payload.intent.kind != "tool":
                raise BuilderExecutionPolicyError("native_materialization_phase_mismatch")
            bridge = agent_bridge_for_ref(payload.ref)
            bridge.authorization.claim_dispatch(
                ref=api_ref(payload.ref), intent=api_intent(payload.intent), permit=api_permit(payload.permit)
            )
        except BuilderExecutionPolicyError:
            raise AgentNativeControlRefused() from None
        return dump_response(AgentDispatchClaimResponse, AgentDispatchClaimResponse(claimed=True))
