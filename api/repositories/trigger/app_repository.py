"""App trigger management with workspace-scoped, bounded database transactions."""

import secrets
from collections.abc import Sequence
from copy import deepcopy
from typing import override

from sqlalchemy import select, update
from sqlalchemy.orm import Session, sessionmaker

from machinery.context import RequestContext
from models.enums import AppTriggerStatus, AppTriggerType
from models.model import App, AppMode
from models.trigger import AppTrigger, WorkflowWebhookTrigger
from models.workflow import NodeNotFoundError, Workflow
from repositories.app.console_repository import require_console_app
from services.app.console_service import ConsoleAppNotFoundError
from services.trigger.app_trigger_store import (
    AppTriggerNotFoundError,
    AppTriggerRecord,
    AppTriggerStore,
    PublishedAppTrigger,
    WebhookTriggerNotFoundError,
    WebhookTriggerRecord,
)
from services.trigger.webhook_service import UnavailableWebhook, WebhookContext, WebhookNotFoundError


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

    def get_webhook_context(self, *, webhook_id: str, debug: bool) -> WebhookContext | UnavailableWebhook:
        with self._session_factory() as session:
            webhook = session.scalar(
                select(WorkflowWebhookTrigger).where(WorkflowWebhookTrigger.webhook_id == webhook_id).limit(1)
            )
            if webhook is None:
                raise WebhookNotFoundError(f"Webhook not found: {webhook_id}")
            status = None
            if debug:
                workflow = session.scalar(
                    select(Workflow)
                    .where(
                        Workflow.tenant_id == webhook.tenant_id,
                        Workflow.app_id == webhook.app_id,
                        Workflow.version == Workflow.VERSION_DRAFT,
                    )
                    .order_by(Workflow.created_at.desc())
                    .limit(1)
                )
            else:
                trigger = session.scalar(
                    select(AppTrigger)
                    .where(
                        AppTrigger.tenant_id == webhook.tenant_id,
                        AppTrigger.app_id == webhook.app_id,
                        AppTrigger.node_id == webhook.node_id,
                        AppTrigger.trigger_type == AppTriggerType.TRIGGER_WEBHOOK,
                    )
                    .limit(1)
                )
                if trigger is None:
                    raise WebhookNotFoundError(f"App trigger not found for webhook {webhook_id}")
                status = AppTriggerStatus(trigger.status)
                # Preserve admission precedence even when an inactive app's stored graph is broken.
                if status != AppTriggerStatus.ENABLED:
                    return UnavailableWebhook(tenant_id=webhook.tenant_id, status=status)
                workflow = session.scalar(
                    select(Workflow)
                    .join(App, App.workflow_id == Workflow.id)
                    .where(
                        App.id == webhook.app_id,
                        App.tenant_id == webhook.tenant_id,
                        Workflow.app_id == webhook.app_id,
                        Workflow.tenant_id == webhook.tenant_id,
                        Workflow.version != Workflow.VERSION_DRAFT,
                    )
                )
            if workflow is None:
                raise WebhookNotFoundError(f"Workflow not found for app {webhook.app_id}")
            try:
                node_config = deepcopy(workflow.get_node_config_by_id(webhook.node_id))
            except NodeNotFoundError as error:
                raise WebhookNotFoundError(str(error)) from error
            return WebhookContext(
                tenant_id=webhook.tenant_id,
                app_id=webhook.app_id,
                webhook_id=webhook.webhook_id,
                node_id=webhook.node_id,
                created_by=webhook.created_by,
                workflow_id=workflow.id,
                node_config=node_config,
                status=status,
            )

    def sync_draft_webhooks(
        self, *, tenant_id: str, app_id: str, created_by: str | None, node_ids: Sequence[str]
    ) -> None:
        # Draft signals are emitted after the draft transaction commits.
        with self._session_factory.begin() as session:
            self.sync_webhooks(
                session=session,
                tenant_id=tenant_id,
                app_id=app_id,
                created_by=created_by,
                node_ids=node_ids,
                remove_stale=False,
            )

    def sync_webhooks(
        self,
        *,
        session: Session,
        tenant_id: str,
        app_id: str,
        created_by: str | None,
        node_ids: Sequence[str],
        remove_stale: bool,
    ) -> None:
        """Retain URLs across draft undo; published deletion joins the publisher transaction."""
        app = session.scalar(select(App).where(App.tenant_id == tenant_id, App.id == app_id).with_for_update())
        if app is None:
            raise WebhookNotFoundError(f"App not found: {app_id}")
        rows = session.scalars(
            select(WorkflowWebhookTrigger).where(
                WorkflowWebhookTrigger.tenant_id == tenant_id,
                WorkflowWebhookTrigger.app_id == app_id,
            )
        ).all()
        existing = {row.node_id: row for row in rows}
        desired = set(node_ids)
        for node_id in desired - existing.keys():
            if created_by is None:
                raise RuntimeError("App is missing created_by; cannot create webhook trigger")
            session.add(
                WorkflowWebhookTrigger(
                    tenant_id=tenant_id,
                    app_id=app_id,
                    created_by=created_by,
                    node_id=node_id,
                    webhook_id=secrets.token_urlsafe(18)[:24],
                )
            )
        if remove_stale:
            for row in rows:
                if row.node_id not in desired:
                    session.delete(row)

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

    def sync_publication(
        self, *, session: Session, tenant_id: str, app_id: str, triggers: Sequence[PublishedAppTrigger]
    ) -> None:
        """Join the publication transaction; registration must roll back with its graph.

        WorkflowService currently owns the publication Session and its version-counter
        lock. Do not commit or create a second transaction here. Remove this borrowed
        Session once publication exposes a unit of work for all graph registrations.
        """
        existing = {
            trigger.node_id: trigger
            for trigger in session.scalars(
                select(AppTrigger).where(AppTrigger.tenant_id == tenant_id, AppTrigger.app_id == app_id)
            )
        }
        current_node_ids = {trigger.node_id for trigger in triggers}
        for node_id, trigger in existing.items():
            if node_id not in current_node_ids:
                session.delete(trigger)
        for trigger in triggers:
            stored = existing.get(trigger.node_id)
            if stored is None:
                session.add(
                    AppTrigger(
                        tenant_id=tenant_id,
                        app_id=app_id,
                        node_id=trigger.node_id,
                        trigger_type=trigger.trigger_type,
                        title=trigger.title,
                        provider_name=trigger.provider_name,
                        status=AppTriggerStatus.ENABLED,
                    )
                )
            elif trigger.title and trigger.title != stored.title:
                # Preserve status and provider/type metadata for existing node IDs.
                stored.title = trigger.title

    def mark_tenant_triggers_rate_limited(self, tenant_id: str) -> None:
        with self._session_factory.begin() as session:
            session.execute(
                update(AppTrigger)
                .where(AppTrigger.tenant_id == tenant_id, AppTrigger.status == AppTriggerStatus.ENABLED)
                .values(status=AppTriggerStatus.RATE_LIMITED)
            )
