"""Forward plugin dispatches without changing native Dify subscriptions."""

from typing import Any

from celery import shared_task

from services.enterprise.base import EnterpriseRequest
from services.feature_service import FeatureService
from services.workflow.entities import PluginTriggerDispatchData


@shared_task(queue="triggered_workflow_dispatcher", autoretry_for=(Exception,), retry_backoff=True, max_retries=5)
def dispatch_deployed_triggers(payload: dict[str, Any]) -> None:
    data = PluginTriggerDispatchData.model_validate(payload)
    if not FeatureService.get_features(data.tenant_id).enable_app_deploy:
        return
    EnterpriseRequest.send_request(
        "POST", "/inner/api/app-deploy/triggers/plugin", json=data.model_dump(mode="json"), raise_for_status=True
    )
