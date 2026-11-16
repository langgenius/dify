"""Resolve enterprise targets without changing native Dify subscriptions.

The enterprise control plane owns revision admission and result deduplication;
Dify resolves credentials and invokes the currently installed plugin locally.
"""

from typing import Any

from pydantic import BaseModel, Field

from core.workflow.nodes.trigger_plugin.entities import TriggerEventNodeData
from extensions.ext_application_services import application_services
from services.enterprise.base import EnterpriseRequest
from services.errors.enterprise import EnterpriseServiceError
from services.workflow.entities import PluginTriggerDispatchData


class PluginTarget(BaseModel):
    trigger_id: str = Field(min_length=1)
    revision_id: str = Field(min_length=1)
    event_key: str = Field(min_length=1)
    node: dict[str, Any]


class PluginTargets(BaseModel):
    data: list[PluginTarget]


class RetryableDispatchError(Exception):
    """A transient control-plane response requires retrying the same payload."""


def enterprise_request(endpoint: str, payload: dict[str, Any]) -> Any:
    """POST a validated dispatch/result with a bounded timeout.

    Return None for a completed/missing target; preserve conflicts for requery;
    retry server failures while leaving permanent client errors terminal.
    """
    try:
        return EnterpriseRequest.send_request("POST", endpoint, json=payload, timeout=30.0, raise_for_status=True)
    except EnterpriseServiceError as exc:
        if exc.status_code == 404:
            return None
        if exc.status_code is not None and exc.status_code >= 500:
            raise RetryableDispatchError(str(exc)) from exc
        raise


def invoke_target(dispatch: PluginTriggerDispatchData, target: PluginTarget) -> dict[str, Any]:
    """Invoke admitted raw DSL node data using a tenant-scoped subscription.

    Accept the original node.data object, including unknown DSL fields, directly.
    Validate dispatch identity before loading credentials. Return JSON variables
    from the installed plugin, regardless of the version recorded in the DSL.
    Raise on invalid identity or plugin failure; the caller reports that error.
    """
    node = TriggerEventNodeData.model_validate(target.node)
    if (
        node.subscription_id != dispatch.subscription_id
        or node.provider_id != dispatch.provider_id
        or node.event_name not in dispatch.events
    ):
        raise ValueError("Target does not match plugin dispatch")
    triggers = application_services().triggers
    subscription = triggers.subscriptions.get_for_execution(
        tenant_id=dispatch.tenant_id, subscription_id=dispatch.subscription_id
    )
    if subscription is None or subscription.provider_id != dispatch.provider_id:
        raise ValueError("Subscription not found")
    prepared = triggers.events.prepare(
        subscription=subscription, event_name=node.event_name, request_id=dispatch.request_id
    )
    return triggers.events.invoke(event=prepared, user_id=subscription.user_id, node_data=node).model_dump(mode="json")
