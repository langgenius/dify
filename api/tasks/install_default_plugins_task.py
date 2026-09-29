"""Install configured marketplace plugins for a newly created tenant."""

import logging

from celery import shared_task

from configs import dify_config
from core.helper import marketplace
from core.plugin.entities.plugin_daemon import PluginInstallTaskStatus
from core.plugin.plugin_service import PluginService
from services.model_provider_service import ModelProviderService

logger = logging.getLogger(__name__)


@shared_task(queue="plugin", bind=True, max_retries=60, default_retry_delay=5)
def configure_default_models_task(self, tenant_id: str, plugin_install_task_id: str | None) -> None:
    """Set explicitly configured default models after default plugins finish installing."""
    if not dify_config.NEW_USER_DEFAULT_MODELS:
        return

    plugin_install_failed = False
    if plugin_install_task_id:
        try:
            install_task = PluginService.fetch_install_task(tenant_id, plugin_install_task_id)
        except Exception as exc:
            logger.warning(
                "Failed to fetch default plugin installation task for tenant %s; retrying",
                tenant_id,
            )
            raise self.retry(exc=exc)

        if install_task.status in (PluginInstallTaskStatus.Pending, PluginInstallTaskStatus.Running):
            raise self.retry()

        plugin_install_failed = install_task.status == PluginInstallTaskStatus.Failed
        if plugin_install_failed:
            failed_plugin_ids = [
                plugin.plugin_id for plugin in install_task.plugins if plugin.status == PluginInstallTaskStatus.Failed
            ]
            logger.error(
                "Default plugin installation failed for tenant %s: %s",
                tenant_id,
                ", ".join(failed_plugin_ids),
            )

    model_provider_service = ModelProviderService()
    failed_model_types: list[str] = []
    for model_type, provider, model in dify_config.NEW_USER_DEFAULT_MODEL_LIST:
        try:
            model_provider_service.update_default_model_of_model_type(
                tenant_id=tenant_id,
                model_type=model_type,
                provider=provider,
                model=model,
            )
        except Exception:
            failed_model_types.append(model_type)
            logger.exception(
                "Failed to configure default model for tenant %s: model_type=%s provider=%s model=%s",
                tenant_id,
                model_type,
                provider,
                model,
            )

    if plugin_install_failed or failed_model_types:
        raise RuntimeError(
            f"Failed to initialize defaults for tenant {tenant_id}; "
            f"model types: {', '.join(failed_model_types) or 'none'}"
        )


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

        response = PluginService.install_from_marketplace_pkg(tenant_id, plugin_identifiers)
        if dify_config.NEW_USER_DEFAULT_MODELS:
            configure_default_models_task.delay(
                tenant_id,
                None if response.all_installed else response.task_id,
            )
    except Exception:
        logger.exception("Failed to install default plugins for tenant %s", tenant_id)
        raise
