from __future__ import annotations

from celery import Task, shared_task

from extensions.ext_application_services import application_services
from libs.helper import current_timestamp
from services.trigger.subscription_refresh_service import TriggerSubscriptionRefreshJob, TriggerSubscriptionRefreshRef


@shared_task(queue="trigger_refresh_executor", bind=True)
def trigger_subscription_refresh(self: Task[[str, str], None], tenant_id: str, subscription_id: str) -> None:
    """Read reservation ownership from headers; old publishers used the fixed token '1'."""
    reservation_token = (self.request.headers or {}).get("reservation_token", "1")
    application_services().workspaces.trigger_subscription_refresh.execute(
        job=TriggerSubscriptionRefreshJob(
            subscription=TriggerSubscriptionRefreshRef(tenant_id=tenant_id, subscription_id=subscription_id),
            token=reservation_token,
        ),
        now=current_timestamp(),
    )
