"""Trigger runtime configuration staged in the caller's bounded transaction."""

import secrets
from collections.abc import Mapping, Sequence
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from core.workflow.nodes.trigger_schedule.entities import ScheduleConfig, SchedulePlanUpdate
from core.workflow.nodes.trigger_schedule.exc import ScheduleNotFoundError
from libs.schedule_utils import calculate_next_run_at
from models import App
from models.enums import AppTriggerStatus
from models.trigger import AppTrigger, WorkflowPluginTrigger, WorkflowSchedulePlan, WorkflowWebhookTrigger


class WorkflowTriggerRepository:
    @staticmethod
    def generate_webhook_id() -> str:
        """Generate a 24-character URL token; uniqueness is enforced by the database."""
        return secrets.token_urlsafe(18)[:24]

    @staticmethod
    def lock_app(session: Session, app: App) -> None:
        session.execute(select(App.id).where(App.id == app.id, App.tenant_id == app.tenant_id).with_for_update()).one()

    @staticmethod
    def sync_webhooks(session: Session, app: App, node_ids: Sequence[str], *, remove_stale: bool) -> None:
        records = session.scalars(
            select(WorkflowWebhookTrigger).where(
                WorkflowWebhookTrigger.tenant_id == app.tenant_id,
                WorkflowWebhookTrigger.app_id == app.id,
            )
        ).all()
        existing = {record.node_id: record for record in records}
        for node_id in node_ids:
            if node_id not in existing:
                session.add(
                    WorkflowWebhookTrigger(
                        app_id=app.id,
                        tenant_id=app.tenant_id,
                        node_id=node_id,
                        webhook_id=WorkflowTriggerRepository.generate_webhook_id(),
                        created_by=app.created_by,
                    )
                )
        if remove_stale:
            for node_id, record in existing.items():
                if node_id not in node_ids:
                    session.delete(record)

    @staticmethod
    def sync_plugins(session: Session, app: App, nodes: Sequence[Mapping[str, Any]]) -> None:
        records = session.scalars(
            select(WorkflowPluginTrigger).where(
                WorkflowPluginTrigger.tenant_id == app.tenant_id,
                WorkflowPluginTrigger.app_id == app.id,
            )
        ).all()
        existing = {record.node_id: record for record in records}
        for node in nodes:
            record = existing.pop(node["node_id"], None)
            if record is None:
                record = WorkflowPluginTrigger(
                    app_id=app.id,
                    tenant_id=app.tenant_id,
                    node_id=node["node_id"],
                    provider_id=node["provider_id"],
                    event_name=node["event_name"],
                    subscription_id=node["subscription_id"],
                )
                session.add(record)
            else:
                record.provider_id = node["provider_id"]
                record.event_name = node["event_name"]
                record.subscription_id = node["subscription_id"]
        for record in existing.values():
            session.delete(record)

    @staticmethod
    def sync_app_triggers(session: Session, app: App, nodes: Sequence[Mapping[str, Any]]) -> None:
        records = session.scalars(
            select(AppTrigger).where(
                AppTrigger.tenant_id == app.tenant_id,
                AppTrigger.app_id == app.id,
            )
        ).all()
        existing = {record.node_id: record for record in records}
        for node in nodes:
            record = existing.pop(node["node_id"], None)
            if record is None:
                session.add(
                    AppTrigger(
                        tenant_id=app.tenant_id,
                        app_id=app.id,
                        node_id=node["node_id"],
                        trigger_type=node["node_type"],
                        title=node["node_title"],
                        provider_name=node.get("node_provider_name") or "",
                        status=AppTriggerStatus.ENABLED,
                    )
                )
            else:
                record.title = node["node_title"] or record.title
                record.trigger_type = node["node_type"]
                record.provider_name = node.get("node_provider_name") or ""
        for record in existing.values():
            session.delete(record)

    @staticmethod
    def sync_schedule(session: Session, app: App, config: ScheduleConfig | None) -> None:
        existing = session.scalar(
            select(WorkflowSchedulePlan).where(
                WorkflowSchedulePlan.tenant_id == app.tenant_id,
                WorkflowSchedulePlan.app_id == app.id,
            )
        )
        if config is None:
            if existing is not None:
                session.delete(existing)
        elif existing is None:
            WorkflowTriggerRepository.create_schedule(app.tenant_id, app.id, config, session=session)
        else:
            WorkflowTriggerRepository.update_schedule(
                existing.id,
                SchedulePlanUpdate(
                    node_id=config.node_id,
                    cron_expression=config.cron_expression,
                    timezone=config.timezone,
                ),
                session=session,
            )

    @staticmethod
    def create_schedule(
        tenant_id: str, app_id: str, config: ScheduleConfig, *, session: Session
    ) -> WorkflowSchedulePlan:
        """
        Create a new schedule with validated configuration.

        Args:
            session: Database session
            tenant_id: Tenant ID
            app_id: Application ID
            config: Validated schedule configuration

        Returns:
            Created WorkflowSchedulePlan instance
        """
        next_run_at = calculate_next_run_at(
            config.cron_expression,
            config.timezone,
        )

        schedule = WorkflowSchedulePlan(
            tenant_id=tenant_id,
            app_id=app_id,
            node_id=config.node_id,
            cron_expression=config.cron_expression,
            timezone=config.timezone,
            next_run_at=next_run_at,
        )

        session.add(schedule)
        session.flush()

        return schedule

    @staticmethod
    def update_schedule(schedule_id: str, updates: SchedulePlanUpdate, *, session: Session) -> WorkflowSchedulePlan:
        """
        Update an existing schedule with validated configuration.

        Args:
            session: Database session
            schedule_id: Schedule ID to update
            updates: Validated update configuration

        Raises:
            ScheduleNotFoundError: If schedule not found

        Returns:
            Updated WorkflowSchedulePlan instance
        """
        schedule = session.get(WorkflowSchedulePlan, schedule_id)
        if not schedule:
            raise ScheduleNotFoundError(f"Schedule not found: {schedule_id}")

        # If time-related fields are updated, synchronously update the next_run_at.
        time_fields_updated = False

        if updates.node_id is not None:
            schedule.node_id = updates.node_id

        if updates.cron_expression is not None:
            schedule.cron_expression = updates.cron_expression
            time_fields_updated = True

        if updates.timezone is not None:
            schedule.timezone = updates.timezone
            time_fields_updated = True

        if time_fields_updated:
            schedule.next_run_at = calculate_next_run_at(
                schedule.cron_expression,
                schedule.timezone,
            )

        session.flush()
        return schedule
