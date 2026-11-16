"""Read-only native trigger state for exact enterprise deployment nodes."""

from uuid import UUID

from flask_restx import Resource
from pydantic import BaseModel, Field, ValidationError
from werkzeug.exceptions import BadRequest

from controllers.common.schema import register_response_schema_models, register_schema_models
from controllers.console.wraps import setup_required
from controllers.inner_api import inner_api_ns
from controllers.inner_api.wraps import enterprise_inner_api_only
from extensions.ext_application_services import application_services
from fields.base import ResponseModel
from services.app.trigger_native import NativeTriggerNode


class NativeTriggerNodePayload(BaseModel):
    node_id: str = Field(min_length=1, max_length=64)
    trigger_type: str = Field(min_length=1, max_length=64)
    subscription_id: str = Field(default="", max_length=255)
    provider_id: str = Field(default="", max_length=255)


class NativeTriggerStatesPayload(BaseModel):
    tenant_id: UUID
    nodes: list[NativeTriggerNodePayload] = Field(max_length=1000)


class NativeTriggerStateResponse(ResponseModel):
    enabled: bool | None
    authorized: bool | None


class NativeTriggerStatesResponse(ResponseModel):
    data: dict[str, NativeTriggerStateResponse]


register_schema_models(inner_api_ns, NativeTriggerStatesPayload)
register_response_schema_models(inner_api_ns, NativeTriggerStatesResponse)


@inner_api_ns.route("/enterprise/apps/<uuid:app_id>/trigger-states")
class NativeTriggerStates(Resource):
    @setup_required
    @enterprise_inner_api_only
    @inner_api_ns.expect(inner_api_ns.models[NativeTriggerStatesPayload.__name__])
    @inner_api_ns.response(200, "Success", inner_api_ns.models[NativeTriggerStatesResponse.__name__])
    def post(self, app_id: UUID):
        """Given authenticated owner-scoped node references, return nullable state without changing triggers."""
        try:
            payload = NativeTriggerStatesPayload.model_validate(inner_api_ns.payload or {})
        except ValidationError as exc:
            raise BadRequest(str(exc)) from exc
        states = application_services().apps.enterprise.native_trigger_states(
            str(payload.tenant_id), str(app_id), [NativeTriggerNode(**node.model_dump()) for node in payload.nodes]
        )
        return NativeTriggerStatesResponse(
            data={
                key: NativeTriggerStateResponse(enabled=value.enabled, authorized=value.authorized)
                for key, value in states.items()
            }
        ).model_dump(mode="json")
