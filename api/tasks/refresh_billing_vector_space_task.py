import logging

from celery import shared_task
from opentelemetry import metrics

from configs import dify_config
from services.billing_service import BillingService

logger = logging.getLogger(__name__)

_MAX_RETRIES = 3
_RETRY_DELAY_SECONDS = 30
_refresh_counter = metrics.get_meter(__name__).create_counter(
    "billing.vector_space_cache_refresh.count",
    description="Number of billing vector-space cache refresh outcomes",
)


@shared_task(queue="dataset", bind=True, max_retries=_MAX_RETRIES, default_retry_delay=_RETRY_DELAY_SECONDS)
def refresh_billing_vector_space_task(self, tenant_id: str) -> None:
    """Refresh billing vector-space usage after vector cleanup has completed."""
    if not dify_config.BILLING_ENABLED:
        return

    try:
        BillingService.invalidate_vector_space_cache(tenant_id)
    except Exception as exc:
        if self.request.retries >= _MAX_RETRIES:
            _refresh_counter.add(1, {"outcome": "exhausted"})
            logger.exception(
                "Billing vector-space cache refresh retry budget exhausted, tenant_id=%s",
                tenant_id,
            )
            raise

        _refresh_counter.add(1, {"outcome": "retry"})
        logger.warning(
            "Billing vector-space cache refresh failed, scheduling retry %d/%d, tenant_id=%s",
            self.request.retries + 1,
            _MAX_RETRIES,
            tenant_id,
            exc_info=True,
        )
        raise self.retry(exc=exc, countdown=_RETRY_DELAY_SECONDS * (2**self.request.retries))

    _refresh_counter.add(1, {"outcome": "success"})
    logger.info("Billing vector-space cache refreshed, tenant_id=%s", tenant_id)


def schedule_billing_vector_space_refresh(tenant_id: str) -> None:
    """Dispatch a best-effort billing refresh without changing cleanup status."""
    if not dify_config.BILLING_ENABLED:
        return

    try:
        refresh_billing_vector_space_task.delay(tenant_id)
    except Exception:
        _refresh_counter.add(1, {"outcome": "dispatch_failure"})
        logger.exception("Failed to dispatch billing vector-space cache refresh, tenant_id=%s", tenant_id)
