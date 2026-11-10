from celery import shared_task

from configs import dify_config
from extensions.ext_application_services import application_services
from libs.helper import current_timestamp


@shared_task(queue="trigger_refresh_publisher")
def trigger_provider_refresh() -> None:
    """Scan due subscriptions in bounded batches and enqueue independently reserved jobs."""
    application_services().workspaces.trigger_subscription_refresh.enqueue_due(
        now=current_timestamp(),
        credential_threshold=dify_config.TRIGGER_PROVIDER_CREDENTIAL_THRESHOLD_SECONDS,
        subscription_threshold=dify_config.TRIGGER_PROVIDER_SUBSCRIPTION_THRESHOLD_SECONDS,
        batch_size=dify_config.TRIGGER_PROVIDER_REFRESH_BATCH_SIZE,
    )
