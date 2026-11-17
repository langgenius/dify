"""Independent, late-acknowledged enterprise plugin dispatch and result tasks."""

import logging
from typing import Any

import httpx
from celery import shared_task
from kombu.exceptions import OperationalError

from services.errors.enterprise import EnterpriseServiceError
from services.trigger.app_deploy_dispatch import (
    PluginTarget,
    PluginTargets,
    RetryableDispatchError,
    enterprise_request,
    invoke_target,
)
from services.workflow.entities import PluginTriggerDispatchData

logger = logging.getLogger(__name__)
TASK_OPTIONS = {
    "queue": "triggered_workflow_dispatcher",
    "acks_late": True,
    "reject_on_worker_lost": True,
    "autoretry_for": (RetryableDispatchError, httpx.TransportError, OperationalError),
    "retry_backoff": 30,
    "retry_backoff_max": 120,
    "retry_jitter": False,
    "max_retries": 8,
}


@shared_task(**TASK_OPTIONS)
def dispatch_deployed_triggers(payload: dict[str, Any]) -> None:
    """Validate the original dispatch and enqueue every admitted target separately.

    Missing dispatches complete; conflicts and transient failures retry without
    altering dispatch identity. No system-feature lookup is required.
    """
    dispatch = PluginTriggerDispatchData.model_validate(payload).model_dump(mode="json")
    try:
        response = enterprise_request("/app-deploy/triggers/plugin/targets", dispatch)
    except EnterpriseServiceError as exc:
        if exc.status_code == 409:
            raise RetryableDispatchError(str(exc)) from exc
        raise
    if response is not None:
        for target in PluginTargets.model_validate(response).data:
            invoke_deployed_trigger.delay(dispatch, target.model_dump(mode="json"))


@shared_task(**TASK_OPTIONS)
def invoke_deployed_trigger(payload: dict[str, Any], target_payload: dict[str, Any]) -> None:
    """Invoke one target and enqueue its success or failure independently.

    A plugin failure cannot prevent sibling targets from executing. Result
    delivery retries do not invoke the plugin again.
    """
    dispatch = PluginTriggerDispatchData.model_validate(payload)
    target = PluginTarget.model_validate(target_payload)
    result = dispatch.model_dump(mode="json") | target.model_dump(exclude={"node"})
    try:
        result.update(invoke_target(dispatch, target))
    except Exception as exc:
        logger.exception(
            "Deployed plugin trigger failed: trigger=%s revision=%s", target.trigger_id, target.revision_id
        )
        result["error"] = str(exc)
    submit_deployed_trigger_result.delay(result)


@shared_task(**TASK_OPTIONS)
def submit_deployed_trigger_result(payload: dict[str, Any]) -> None:
    """Deliver one immutable result; requery admission if its revision conflicts.

    Missing targets complete and transient errors retry this result alone.
    Enterprise deduplicates by trigger_id and event_key; revision_id checks admission.
    """
    try:
        enterprise_request("/app-deploy/triggers/plugin/results", payload)
    except EnterpriseServiceError as exc:
        if exc.status_code == 409:
            dispatch_deployed_triggers.delay(PluginTriggerDispatchData.model_validate(payload).model_dump(mode="json"))
        else:
            raise
