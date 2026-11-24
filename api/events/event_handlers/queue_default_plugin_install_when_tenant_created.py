"""Queue default marketplace plugin installation after tenant creation."""

import logging

from configs import dify_config
from events.tenant_event import tenant_was_created
from repositories.tokener_signup_canary_repository import signup_used_staging_package
from tasks.install_default_plugins_task import install_default_plugins_task

logger = logging.getLogger(__name__)


@tenant_was_created.connect
def handle(sender, **kwargs) -> None:
    """Keep tenant creation non-blocking while installing configured plugins asynchronously."""
    plugin_ids = dify_config.NEW_USER_DEFAULT_PLUGIN_ID_LIST
    try:
        if (
            dify_config.get_agent_dev_staging_tokener_billing_url() is not None
            and "langgenius/openai" not in plugin_ids
            and signup_used_staging_package(sender.id)
        ):
            plugin_ids = [*plugin_ids, "langgenius/openai"]
        if plugin_ids:
            install_default_plugins_task.delay(sender.id, plugin_ids)
    except Exception:
        logger.exception("Failed to queue default plugin installation for tenant %s", sender.id)
