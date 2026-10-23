from celery import shared_task

from extensions.ext_application_services import application_services
from libs.helper import current_timestamp
from services.trigger.subscription_refresh_service import TriggerSubscriptionRefreshJob, TriggerSubscriptionRefreshRef


@shared_task(queue="trigger_refresh_executor")
def trigger_subscription_refresh(tenant_id: str, subscription_id: str, reservation_token: str = "1") -> None:
    """Run only our reservation; the default accepts tasks queued by the previous publisher."""
    application_services().workspaces.trigger_subscription_refresh.execute(
        job=TriggerSubscriptionRefreshJob(
            subscription=TriggerSubscriptionRefreshRef(tenant_id=tenant_id, subscription_id=subscription_id),
            token=reservation_token,
        ),
        now=current_timestamp(),
    )
