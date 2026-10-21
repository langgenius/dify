"""App trigger management with workspace-scoped, bounded database transactions."""

from typing import override

from sqlalchemy import select
from sqlalchemy.orm import Session, sessionmaker

from machinery.context import RequestContext
from models.enums import AppTriggerStatus
from models.model import AppMode
from models.trigger import AppTrigger, WorkflowWebhookTrigger
from repositories.app.console_repository import require_console_app
from services.app.console_service import ConsoleAppNotFoundError
from services.trigger.app_trigger_store import (
    AppTriggerNotFoundError,
    AppTriggerRecord,
    AppTriggerStore,
    WebhookTriggerNotFoundError,
    WebhookTriggerRecord,
)


def _require_workflow_app(session: Session, context: RequestContext, app_id: str) -> None:
    app = require_console_app(session, context, app_id)
    if app.mode != AppMode.WORKFLOW:
        raise ConsoleAppNotFoundError(f"App mode is not in the supported list: {{{AppMode.WORKFLOW.value!r}}}")


def _trigger_record(trigger: AppTrigger) -> AppTriggerRecord:
    return AppTriggerRecord(
        id=trigger.id,
        trigger_type=trigger.trigger_type,
        title=trigger.title,
        node_id=trigger.node_id,
        provider_name=trigger.provider_name,
        status=trigger.status,
        created_at=trigger.created_at,
        updated_at=trigger.updated_at,
    )


class SQLAlchemyAppTriggerRepository(AppTriggerStore):
    def __init__(self, *, session_factory: sessionmaker[Session]) -> None:
        self._session_factory = session_factory

    @override
    def get_webhook(self, context: RequestContext, app_id: str, node_id: str) -> WebhookTriggerRecord:
        with self._session_factory() as session:
            _require_workflow_app(session, context, app_id)
            webhook = session.scalar(
                select(WorkflowWebhookTrigger).where(
                    WorkflowWebhookTrigger.tenant_id == context.active_workspace_id,
                    WorkflowWebhookTrigger.app_id == app_id,
                    WorkflowWebhookTrigger.node_id == node_id,
                )
            )
            if webhook is None:
                raise WebhookTriggerNotFoundError("Webhook trigger not found for this node")
            return WebhookTriggerRecord(
                id=webhook.id,
                webhook_id=webhook.webhook_id,
                node_id=webhook.node_id,
                created_at=webhook.created_at,
            )

    @override
    def list_triggers(self, context: RequestContext, app_id: str) -> tuple[AppTriggerRecord, ...]:
        with self._session_factory() as session:
            _require_workflow_app(session, context, app_id)
            triggers = session.scalars(
                select(AppTrigger)
                .where(AppTrigger.tenant_id == context.active_workspace_id, AppTrigger.app_id == app_id)
                .order_by(AppTrigger.created_at.desc(), AppTrigger.id.desc())
            )
            return tuple(_trigger_record(trigger) for trigger in triggers)

    @override
    def set_enabled(self, context: RequestContext, app_id: str, trigger_id: str, *, enabled: bool) -> AppTriggerRecord:
        with self._session_factory.begin() as session:
            _require_workflow_app(session, context, app_id)
            trigger = session.scalar(
                select(AppTrigger).where(
                    AppTrigger.id == trigger_id,
                    AppTrigger.tenant_id == context.active_workspace_id,
                    AppTrigger.app_id == app_id,
                )
            )
            if trigger is None:
                raise AppTriggerNotFoundError("Trigger not found")
            trigger.status = AppTriggerStatus.ENABLED if enabled else AppTriggerStatus.DISABLED
            session.flush()
            return _trigger_record(trigger)
