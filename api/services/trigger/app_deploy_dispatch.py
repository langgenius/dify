"""Forward plugin dispatches without changing native Dify subscriptions."""

from typing import Any

from celery import shared_task

from services.enterprise.base import EnterpriseRequest
from services.system_feature_service import SystemFeatureService
from services.workflow.entities import PluginTriggerDispatchData


# A crashed enterprise owner retains a two-minute dispatch lease. The retry
# window must cross that lease even when every request fails immediately.
@shared_task(
    queue="triggered_workflow_dispatcher",
    autoretry_for=(Exception,),
    retry_backoff=30,
    retry_backoff_max=120,
    retry_jitter=False,
    max_retries=8,
)
def dispatch_deployed_triggers(payload: dict[str, Any]) -> None:
    data = PluginTriggerDispatchData.model_validate(payload)
    if not SystemFeatureService.get_public_system_features().enable_app_deploy:
        return
    EnterpriseRequest.send_request(
        "POST", "/inner/api/app-deploy/triggers/plugin", json=data.model_dump(mode="json"), raise_for_status=True
    )
