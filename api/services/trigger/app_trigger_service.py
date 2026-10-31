"""Publication policy and best-effort quota status updates for application triggers."""

import logging
from collections.abc import Iterable, Mapping
from typing import Any

from core.trigger.constants import TRIGGER_NODE_TYPES
from services.trigger.app_trigger_store import (
    AppTriggerPublicationWriter,
    AppTriggerStatusWriter,
    PublishedAppTrigger,
)

logger = logging.getLogger(__name__)


class AppTriggerService:
    """Keep status persistence failures from replacing the original quota rejection."""

    def __init__(self, *, triggers: AppTriggerStatusWriter) -> None:
        self._triggers = triggers

    def mark_tenant_triggers_rate_limited(self, tenant_id: str) -> None:
        try:
            self._triggers.mark_tenant_triggers_rate_limited(tenant_id)
            logger.info("Marked all enabled triggers as rate limited for tenant %s", tenant_id)
        except Exception:
            logger.exception("Failed to mark all enabled triggers as rate limited for tenant %s", tenant_id)


class AppTriggerPublicationService:
    """Derive published trigger registration without changing existing enablement."""

    def __init__(self, *, sync_triggers: AppTriggerPublicationWriter) -> None:
        self._sync_triggers = sync_triggers

    def sync(self, *, tenant_id: str, app_id: str, nodes: Iterable[Mapping[str, Any]]) -> None:
        triggers = tuple(
            PublishedAppTrigger(
                node_id=node["id"],
                trigger_type=node["data"]["type"],
                title=node["data"].get("title"),
                provider_name=node["data"].get("provider_name"),
            )
            for node in nodes
            if node.get("data", {}).get("type") in TRIGGER_NODE_TYPES
        )
        self._sync_triggers(tenant_id=tenant_id, app_id=app_id, triggers=triggers)
