"""Invoke a persisted plugin event using deployed node parameters."""

from flask import request
from flask_restx import Resource
from pydantic import BaseModel, Field

from controllers.inner_api import inner_api_ns
from controllers.inner_api.wraps import enterprise_inner_api_only
from core.workflow.nodes.trigger_plugin.entities import TriggerEventNodeData
from extensions.ext_application_services import application_services


class InvokeTriggerPayload(BaseModel):
    tenant_id: str = Field(min_length=1)
    request_id: str = Field(pattern=r"^trigger_request_[0-9]+_[0-9a-f]{12}$")
    node: TriggerEventNodeData


@inner_api_ns.route("/app-deploy/triggers/invoke")
class InvokeDeployedTrigger(Resource):
    @enterprise_inner_api_only
    def post(self):
        payload = InvokeTriggerPayload.model_validate(request.get_json())
        triggers = application_services().triggers
        subscription = triggers.subscriptions.get_for_execution(
            tenant_id=payload.tenant_id, subscription_id=payload.node.subscription_id
        )
        if subscription is None or subscription.provider_id != payload.node.provider_id:
            return {"error": "subscription_not_found"}, 404
        prepared = triggers.events.prepare(
            subscription=subscription, event_name=payload.node.event_name, request_id=payload.request_id
        )
        if prepared.definition.plugin_unique_identifier != payload.node.plugin_unique_identifier:
            return {"error": "plugin_version_changed"}, 409
        result = triggers.events.invoke(event=prepared, user_id=subscription.user_id, node_data=payload.node)
        return result.model_dump(mode="json")
