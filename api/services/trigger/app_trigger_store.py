"""Detached records and persistence contract for Console app trigger management."""

from dataclasses import dataclass
from datetime import datetime
from typing import Protocol

from machinery.context import RequestContext


class WebhookTriggerNotFoundError(Exception):
    """The requested node has no webhook in the admitted app and workspace."""


class AppTriggerNotFoundError(Exception):
    """The trigger does not belong to the admitted app and workspace."""


@dataclass(frozen=True, slots=True)
class AppTriggerRecord:
    """Persisted values; None preserves a missing legacy node or provider name."""

    id: str
    trigger_type: str
    title: str
    node_id: str | None
    provider_name: str | None
    status: str
    created_at: datetime
    updated_at: datetime


@dataclass(frozen=True, slots=True)
class WebhookTriggerRecord:
    id: str
    webhook_id: str
    node_id: str
    created_at: datetime


class AppTriggerStore(Protocol):
    def get_webhook(self, context: RequestContext, app_id: str, node_id: str) -> WebhookTriggerRecord: ...

    def list_triggers(self, context: RequestContext, app_id: str) -> tuple[AppTriggerRecord, ...]: ...

    def set_enabled(
        self, context: RequestContext, app_id: str, trigger_id: str, *, enabled: bool
    ) -> AppTriggerRecord: ...
