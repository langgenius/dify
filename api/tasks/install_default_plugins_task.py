"""Install configured marketplace plugins for a newly created tenant."""

import logging

from celery import shared_task

from core.helper import marketplace
from core.plugin.plugin_service import PluginService

logger = logging.getLogger(__name__)


@shared_task(queue="plugin")
def install_default_plugins_task(tenant_id: str, plugin_ids: list[str]) -> None:
    """Install the latest marketplace versions of the configured plugins."""
    if not plugin_ids:
        return

    try:
        manifests = {manifest.plugin_id: manifest for manifest in marketplace.batch_fetch_plugin_manifests(plugin_ids)}
        plugin_identifiers = [
            manifests[plugin_id].latest_package_identifier for plugin_id in plugin_ids if plugin_id in manifests
        ]
        missing_plugin_ids = [plugin_id for plugin_id in plugin_ids if plugin_id not in manifests]
        if missing_plugin_ids:
            logger.warning("Default plugins not found in marketplace: %s", ", ".join(missing_plugin_ids))
        if not plugin_identifiers:
            return

        PluginService.install_from_marketplace_pkg(tenant_id, plugin_identifiers)
    except Exception:
        logger.exception("Failed to install default plugins for tenant %s", tenant_id)
        raise
