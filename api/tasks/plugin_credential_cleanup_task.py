"""Retry plugin credential cleanup after a successful daemon uninstall."""

import logging

from celery import shared_task

from core.plugin.plugin_service import PluginService

logger = logging.getLogger(__name__)

_MAX_RETRIES = 5
_RETRY_DELAY_SECONDS = 60


@shared_task(
    queue="plugin",
    bind=True,
    max_retries=_MAX_RETRIES,
    default_retry_delay=_RETRY_DELAY_SECONDS,
)
def cleanup_plugin_credentials_task(self, tenant_id: str, plugin_id: str) -> None:
    """Retry deleting credentials left after a plugin daemon uninstall."""
    try:
        PluginService._cleanup_plugin_credentials(tenant_id, plugin_id)
    except Exception as exc:
        logger.exception(
            "Plugin credential cleanup retry failed: tenant_id=%s plugin_id=%s",
            tenant_id,
            plugin_id,
        )
        raise self.retry(exc=exc, countdown=_RETRY_DELAY_SECONDS)
