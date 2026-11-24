"""Authenticated resolution of the creator for an Enterprise trigger occurrence."""

from typing import Literal
from uuid import UUID

from flask_restx import Resource
from pydantic import BaseModel, ValidationError
from werkzeug.exceptions import BadRequest, NotFound

from controllers.common.schema import register_response_schema_models, register_schema_models
from controllers.console.wraps import setup_required
from controllers.inner_api import inner_api_ns
from controllers.inner_api.wraps import enterprise_inner_api_only
from core.db.session_factory import session_factory
from extensions.ext_application_services import application_services
from fields.base import ResponseModel
from services.enterprise.trigger_creator import TriggerCreatorService


class TriggerCreatorPayload(BaseModel):
    tenant_id: UUID
    trigger_type: Literal["trigger-schedule", "trigger-webhook", "trigger-plugin"]
    subscription_id: UUID | None = None


class TriggerCreatorResponse(ResponseModel):
    created_by: UUID
    created_by_role: Literal["account", "end_user"]


register_schema_models(inner_api_ns, TriggerCreatorPayload)
register_response_schema_models(inner_api_ns, TriggerCreatorResponse)


@inner_api_ns.route("/enterprise/apps/<uuid:app_id>/trigger-creator")
class TriggerCreator(Resource):
    @setup_required
    @enterprise_inner_api_only
    @inner_api_ns.expect(inner_api_ns.models[TriggerCreatorPayload.__name__])
    @inner_api_ns.response(200, "Success", inner_api_ns.models[TriggerCreatorResponse.__name__])
    def post(self, app_id: UUID):
        """Resolve a tenant-owned app's actor; reject malformed or unknown owner references."""
        try:
            payload = TriggerCreatorPayload.model_validate(inner_api_ns.payload or {})
        except ValidationError as exc:
            raise BadRequest(str(exc)) from exc
        if payload.trigger_type == "trigger-plugin" and payload.subscription_id is None:
            raise BadRequest("subscription_id is required for plugin triggers")
        service = TriggerCreatorService(
            sessions=session_factory.get_session_maker(), end_users=application_services().app_scoped_end_users.commands
        )
        try:
            actor = service.resolve(
                tenant_id=str(payload.tenant_id),
                app_id=str(app_id),
                trigger_type=payload.trigger_type,
                subscription_id=str(payload.subscription_id) if payload.subscription_id else "",
            )
        except LookupError as exc:
            raise NotFound(str(exc)) from exc
        return TriggerCreatorResponse.model_validate(
            {"created_by": actor.id, "created_by_role": actor.role}
        ).model_dump(mode="json")
