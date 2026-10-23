import logging

from celery import shared_task

from core.trigger.utils.locks import build_trigger_refresh_lock_key
from extensions.ext_application_services import application_services
from extensions.ext_redis import redis_client
from libs.helper import current_timestamp

logger = logging.getLogger(__name__)


@shared_task(queue="trigger_refresh_executor")
def trigger_subscription_refresh(tenant_id: str, subscription_id: str) -> None:
    """Refresh a trigger subscription if needed, guarded by a Redis in-flight lock."""
    lock_key: str = build_trigger_refresh_lock_key(tenant_id, subscription_id)
    if not redis_client.get(lock_key):
        logger.debug("Refresh lock missing, skip: %s", lock_key)
        return

    logger.info("Begin subscription refresh: tenant=%s id=%s", tenant_id, subscription_id)
    try:
        application_services().workspaces.trigger_subscription_renewal.refresh_if_due(
            tenant_id=tenant_id, subscription_id=subscription_id, now=current_timestamp()
        )
    finally:
        try:
            redis_client.delete(lock_key)
            logger.debug("Lock released: %s", lock_key)
        except Exception:
            # Best-effort lock cleanup
            logger.warning("Failed to release lock: %s", lock_key, exc_info=True)
