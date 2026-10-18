"""Authenticated service-only native effect control; human decisions live in C04."""

from dify_agent.adapters.native_testing.client import (
    AgentBeforeCallPayload,
    AgentMaterialization,
    AgentMaterializePayload,
    AgentOutcomePayload,
    AgentPhysicalDispatchPayload,
)
from dify_agent.protocol.native_testing import (
    MAX_AGENT_CONFIG_BYTES,
    MAX_AGENT_CONTROL_BYTES,
    AgentEffectDecision,
    AgentEffectIntent,
    AgentEffectReceipt,
    AgentPreparedConfigResponse,
    AgentPrepareIntentPayload,
    AgentPrepareRunPayload,
    AgentPrepareRunResponse,
    AgentReadPreparedConfigPayload,
    AgentReadResultPayload,
    AgentReadResultResponse,
    AgentStoredResultResponse,
    AgentStoreResultPayload,
)
from flask import make_response, request
from flask_restx import Resource
from pydantic import RootModel, ValidationError

from controllers.common.schema import (
    register_response_schema_models,
    register_schema_models,
)
from controllers.inner_api import inner_api_ns
from controllers.inner_api.wraps import agent_endpoint_api_only
from fields.base import ResponseModel
from libs.exception import BaseHTTPException
from libs.external_api import error_responses
from libs.helper import dump_response
from services.dify_builder.execution_contracts import BuilderExecutionPolicyError
from services.dify_builder.native_testing.agent_bridge import (
    agent_bridge_for_ref,
)
from services.dify_builder.native_testing.agent_operations import agent_operations_for_ref
from services.dify_builder.native_testing.agent_preparation import (
    agent_preparation_for_ref,
)


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


def _parse(model, *, limit=1024 * 1024):
    request.max_content_length = limit
    try:
        return model.model_validate(inner_api_ns.payload or {})
    except ValidationError:
        raise ValueError("Invalid native Agent control payload") from None


register_schema_models(
    inner_api_ns,
    AgentBeforeCallPayload,
    AgentOutcomePayload,
    AgentMaterializePayload,
    AgentPhysicalDispatchPayload,
)
register_response_schema_models(
    inner_api_ns,
    AgentBeforeCallResponse,
    AgentOutcomeResponse,
    AgentMaterializeResponse,
    AgentDispatchClaimResponse,
)


@inner_api_ns.route("/agent/native-testing/before-call")
class AgentNativeBeforeCallApi(Resource):
    @agent_endpoint_api_only
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
    @agent_endpoint_api_only
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
    @agent_endpoint_api_only
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
    @agent_endpoint_api_only
    @inner_api_ns.expect(inner_api_ns.models[AgentPhysicalDispatchPayload.__name__])
    @inner_api_ns.response(200, "Physical dispatch claimed", inner_api_ns.models[AgentDispatchClaimResponse.__name__])
    @error_responses(AgentNativeControlRefused)
    def post(self):
        _parse(AgentPhysicalDispatchPayload)
        # Physical permits belong to the actual service/runtime dispatch owner.
        # S2a installs no such owner, including for this historical control URL.
        raise AgentNativeControlRefused()


class AgentInitialPrepareResponse(AgentPrepareRunResponse, ResponseModel):
    pass


class AgentCurrentConfigResponse(AgentPreparedConfigResponse, ResponseModel):
    pass


register_schema_models(inner_api_ns, AgentPrepareRunPayload, AgentReadPreparedConfigPayload)
register_response_schema_models(inner_api_ns, AgentInitialPrepareResponse, AgentCurrentConfigResponse)


def _bounded_private_response(model, result, limit):
    value = model.model_validate(result, from_attributes=True)
    body = value.model_dump_json().encode("utf-8")
    if len(body) > limit:
        raise AgentNativeControlRefused()
    response = make_response(body)
    response.headers["Content-Type"] = "application/json"
    response.headers["Cache-Control"] = "no-store"
    return response


@inner_api_ns.route("/agent/native-testing/prepare-run")
class AgentNativePrepareRunApi(Resource):
    @agent_endpoint_api_only
    @inner_api_ns.expect(inner_api_ns.models[AgentPrepareRunPayload.__name__])
    @inner_api_ns.response(
        200,
        "Immutable actual Agent Run association",
        inner_api_ns.models[AgentInitialPrepareResponse.__name__],
    )
    @error_responses(AgentNativeControlRefused)
    def post(self):
        payload = _parse(AgentPrepareRunPayload, limit=MAX_AGENT_CONTROL_BYTES)
        try:
            result = agent_preparation_for_ref(payload.parent_node.ref).bind_created_run(payload=payload)
        except BuilderExecutionPolicyError:
            raise AgentNativeControlRefused() from None
        return _bounded_private_response(AgentInitialPrepareResponse, result, MAX_AGENT_CONTROL_BYTES)


@inner_api_ns.route("/agent/native-testing/prepared-config")
class AgentNativePreparedConfigApi(Resource):
    @agent_endpoint_api_only
    @inner_api_ns.expect(inner_api_ns.models[AgentReadPreparedConfigPayload.__name__])
    @inner_api_ns.response(
        200,
        "Current protected executable config",
        inner_api_ns.models[AgentCurrentConfigResponse.__name__],
    )
    @error_responses(AgentNativeControlRefused)
    def post(self):
        payload = _parse(AgentReadPreparedConfigPayload, limit=MAX_AGENT_CONTROL_BYTES)
        try:
            result = agent_preparation_for_ref(payload.parent_node.ref).read_prepared_config(payload=payload)
        except BuilderExecutionPolicyError:
            raise AgentNativeControlRefused() from None
        return _bounded_private_response(AgentCurrentConfigResponse, result, MAX_AGENT_CONFIG_BYTES)


class AgentPreparedIntentResponse(AgentEffectIntent, ResponseModel):
    pass


class AgentResultStoredResponse(AgentStoredResultResponse, ResponseModel):
    pass


class AgentResultReadResponse(AgentReadResultResponse, ResponseModel):
    pass


register_schema_models(inner_api_ns, AgentPrepareIntentPayload, AgentStoreResultPayload, AgentReadResultPayload)
register_response_schema_models(
    inner_api_ns, AgentPreparedIntentResponse, AgentResultStoredResponse, AgentResultReadResponse
)


@inner_api_ns.route("/agent/native-testing/prepare-intent")
class AgentNativePrepareIntentApi(Resource):
    @agent_endpoint_api_only
    @inner_api_ns.expect(inner_api_ns.models[AgentPrepareIntentPayload.__name__])
    @inner_api_ns.response(200, "Current actual call intent", inner_api_ns.models[AgentPreparedIntentResponse.__name__])
    @error_responses(AgentNativeControlRefused)
    def post(self):
        payload = _parse(AgentPrepareIntentPayload, limit=MAX_AGENT_CONFIG_BYTES)
        try:
            result = agent_operations_for_ref(payload.ref).prepare_intent(
                ref=payload.ref,
                key=payload.key,
                boundary=payload.boundary,
                target=payload.target,
                parameters=payload.parameters,
            )
        except BuilderExecutionPolicyError:
            raise AgentNativeControlRefused() from None
        return _bounded_private_response(AgentPreparedIntentResponse, result, MAX_AGENT_CONFIG_BYTES)


@inner_api_ns.route("/agent/native-testing/results")
class AgentNativeStoreResultApi(Resource):
    @agent_endpoint_api_only
    @inner_api_ns.expect(inner_api_ns.models[AgentStoreResultPayload.__name__])
    @inner_api_ns.response(200, "Actual API result reference", inner_api_ns.models[AgentResultStoredResponse.__name__])
    @error_responses(AgentNativeControlRefused)
    def post(self):
        payload = _parse(AgentStoreResultPayload, limit=MAX_AGENT_CONFIG_BYTES)
        try:
            result_ref = agent_operations_for_ref(payload.ref).store_result(
                ref=payload.ref, key=payload.key, result=payload.result
            )
        except BuilderExecutionPolicyError:
            raise AgentNativeControlRefused() from None
        return _bounded_private_response(AgentResultStoredResponse, {"result_ref": result_ref}, MAX_AGENT_CONTROL_BYTES)


@inner_api_ns.route("/agent/native-testing/read-result")
class AgentNativeReadResultApi(Resource):
    @agent_endpoint_api_only
    @inner_api_ns.expect(inner_api_ns.models[AgentReadResultPayload.__name__])
    @inner_api_ns.response(200, "Real protected result", inner_api_ns.models[AgentResultReadResponse.__name__])
    @error_responses(AgentNativeControlRefused)
    def post(self):
        payload = _parse(AgentReadResultPayload, limit=MAX_AGENT_CONTROL_BYTES)
        try:
            result = agent_operations_for_ref(payload.ref).read_result(
                ref=payload.ref, result_ref=payload.result_ref
            )
        except BuilderExecutionPolicyError:
            raise AgentNativeControlRefused() from None
        return _bounded_private_response(AgentResultReadResponse, {"result": result}, MAX_AGENT_CONFIG_BYTES)
