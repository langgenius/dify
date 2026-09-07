"""Queue default marketplace plugin installation after tenant creation."""

import logging

from configs import dify_config
from events.tenant_event import tenant_was_created
from tasks.install_default_plugins_task import install_default_plugins_task

logger = logging.getLogger(__name__)


@tenant_was_created.connect
def handle(sender, **kwargs) -> None:
    """Keep tenant creation non-blocking while installing configured plugins asynchronously."""
    plugin_ids = dify_config.NEW_USER_DEFAULT_PLUGIN_ID_LIST
    if not plugin_ids:
        return

    try:
        install_default_plugins_task.delay(sender.id, plugin_ids)
    except Exception:
        logger.exception("Failed to queue default plugin installation for tenant %s", sender.id)
