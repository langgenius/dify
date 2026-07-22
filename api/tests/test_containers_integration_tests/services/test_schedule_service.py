"""Testcontainers integration tests for schedule service SQL-backed behavior."""

from datetime import datetime
from types import SimpleNamespace
from uuid import uuid4

import pytest
from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from core.workflow.nodes.trigger_schedule.entities import ScheduleConfig, SchedulePlanUpdate
from core.workflow.nodes.trigger_schedule.exc import ScheduleNotFoundError
from events.event_handlers.sync_workflow_schedule_when_app_published import sync_schedule_from_workflow
from models.account import Account, Tenant, TenantAccountJoin, TenantAccountRole
from models.trigger import WorkflowSchedulePlan
from services.errors.account import AccountNotFoundError
from services.trigger.schedule_service import ScheduleService


class ScheduleServiceIntegrationFactory:
    @staticmethod
    def create_account_with_tenant(
        container_session: Session,
        role: TenantAccountRole = TenantAccountRole.OWNER,
    ) -> tuple[Account, Tenant]:
        account = Account(
            email=f"{uuid4()}@example.com",
            name=f"user-{uuid4()}",
            interface_language="en-US",
            status="active",
        )
        tenant = Tenant(name=f"tenant-{uuid4()}", status="normal")
        container_session.add_all([account, tenant])
        container_session.flush()

        join = TenantAccountJoin(
            tenant_id=tenant.id,
            account_id=account.id,
            role=role,
            current=True,
        )
        container_session.add(join)
        container_session.commit()

        account.current_tenant = tenant
        return account, tenant

    @staticmethod
    def create_schedule_plan(
        container_session: Session,
        *,
        tenant_id: str,
        app_id: str | None = None,
        node_id: str = "start",
        cron_expression: str = "30 10 * * *",
        timezone: str = "UTC",
        next_run_at: datetime | None = None,
    ) -> WorkflowSchedulePlan:
        schedule = WorkflowSchedulePlan(
            tenant_id=tenant_id,
            app_id=app_id or str(uuid4()),
            node_id=node_id,
            cron_expression=cron_expression,
            timezone=timezone,
            next_run_at=next_run_at,
        )
        container_session.add(schedule)
        container_session.commit()
        return schedule


def _cron_workflow(
    *,
    node_id: str = "start",
    cron_expression: str = "30 10 * * *",
    timezone: str = "UTC",
):
    return SimpleNamespace(
        graph_dict={
            "nodes": [
                {
                    "id": node_id,
                    "data": {
                        "type": "trigger-schedule",
                        "mode": "cron",
                        "cron_expression": cron_expression,
                        "timezone": timezone,
                    },
                }
            ]
        }
    )


def _no_schedule_workflow():
    return SimpleNamespace(
        graph_dict={
            "nodes": [
                {
                    "id": "node-1",
                    "data": {"type": "llm"},
                }
            ]
        }
    )


class TestScheduleServiceIntegration:
    def test_create_schedule_persists_schedule(self, container_session: Session):
        account, tenant = ScheduleServiceIntegrationFactory.create_account_with_tenant(container_session)
        expected_next_run = datetime(2026, 1, 1, 10, 30, 0)
        config = ScheduleConfig(
            node_id="start",
            cron_expression="30 10 * * *",
            timezone="UTC",
        )

        with pytest.MonkeyPatch.context() as monkeypatch:
            monkeypatch.setattr(
                "services.trigger.schedule_service.calculate_next_run_at",
                lambda *_args, **_kwargs: expected_next_run,
            )
            schedule = ScheduleService.create_schedule(
                session=container_session,
                tenant_id=tenant.id,
                app_id=str(uuid4()),
                config=config,
            )

        persisted = container_session.get(WorkflowSchedulePlan, schedule.id)
        assert persisted is not None
        assert persisted.tenant_id == tenant.id
        assert persisted.node_id == "start"
        assert persisted.cron_expression == "30 10 * * *"
        assert persisted.timezone == "UTC"
        assert persisted.next_run_at == expected_next_run

    def test_update_schedule_updates_fields_and_recomputes_next_run(self, container_session: Session):
        _account, tenant = ScheduleServiceIntegrationFactory.create_account_with_tenant(container_session)
        schedule = ScheduleServiceIntegrationFactory.create_schedule_plan(
            container_session,
            tenant_id=tenant.id,
            cron_expression="30 10 * * *",
            timezone="UTC",
        )
        expected_next_run = datetime(2026, 1, 2, 12, 0, 0)

        with pytest.MonkeyPatch.context() as monkeypatch:
            monkeypatch.setattr(
                "services.trigger.schedule_service.calculate_next_run_at",
                lambda *_args, **_kwargs: expected_next_run,
            )
            updated = ScheduleService.update_schedule(
                session=container_session,
                schedule_id=schedule.id,
                updates=SchedulePlanUpdate(
                    cron_expression="0 12 * * *",
                    timezone="America/New_York",
                ),
            )

        container_session.refresh(updated)
        assert updated.cron_expression == "0 12 * * *"
        assert updated.timezone == "America/New_York"
        assert updated.next_run_at == expected_next_run

    def test_update_schedule_updates_only_node_id_without_recomputing_time(self, container_session: Session):
        _account, tenant = ScheduleServiceIntegrationFactory.create_account_with_tenant(container_session)
        initial_next_run = datetime(2026, 1, 1, 10, 0, 0)
        schedule = ScheduleServiceIntegrationFactory.create_schedule_plan(
            container_session,
            tenant_id=tenant.id,
            next_run_at=initial_next_run,
        )

        with pytest.MonkeyPatch.context() as monkeypatch:
            calls: list[tuple] = []

            def _track(*args, **kwargs):
                calls.append((args, kwargs))
                return datetime(2026, 1, 9, 10, 0, 0)

            monkeypatch.setattr("services.trigger.schedule_service.calculate_next_run_at", _track)
            updated = ScheduleService.update_schedule(
                session=container_session,
                schedule_id=schedule.id,
                updates=SchedulePlanUpdate(node_id="node-new"),
            )

        container_session.refresh(updated)
        assert updated.node_id == "node-new"
        assert updated.next_run_at == initial_next_run
        assert calls == []

    def test_update_schedule_not_found_raises(self, container_session: Session):
        with pytest.raises(ScheduleNotFoundError, match="Schedule not found"):
            ScheduleService.update_schedule(
                session=container_session,
                schedule_id=str(uuid4()),
                updates=SchedulePlanUpdate(node_id="node-new"),
            )

    def test_delete_schedule_removes_row(self, container_session: Session):
        _account, tenant = ScheduleServiceIntegrationFactory.create_account_with_tenant(container_session)
        schedule = ScheduleServiceIntegrationFactory.create_schedule_plan(
            container_session,
            tenant_id=tenant.id,
        )

        ScheduleService.delete_schedule(
            session=container_session,
            schedule_id=schedule.id,
        )
        container_session.commit()

        assert container_session.get(WorkflowSchedulePlan, schedule.id) is None

    def test_delete_schedule_not_found_raises(self, container_session: Session):
        with pytest.raises(ScheduleNotFoundError, match="Schedule not found"):
            ScheduleService.delete_schedule(
                session=container_session,
                schedule_id=str(uuid4()),
            )

    def test_get_tenant_owner_returns_owner_account(self, container_session: Session):
        owner, tenant = ScheduleServiceIntegrationFactory.create_account_with_tenant(
            container_session,
            role=TenantAccountRole.OWNER,
        )

        result = ScheduleService.get_tenant_owner(
            session=container_session,
            tenant_id=tenant.id,
        )

        assert result.id == owner.id

    def test_get_tenant_owner_falls_back_to_admin(self, container_session: Session):
        admin, tenant = ScheduleServiceIntegrationFactory.create_account_with_tenant(
            container_session,
            role=TenantAccountRole.ADMIN,
        )

        result = ScheduleService.get_tenant_owner(
            session=container_session,
            tenant_id=tenant.id,
        )

        assert result.id == admin.id

    def test_get_tenant_owner_raises_when_account_record_missing(self, container_session: Session):
        _account, tenant = ScheduleServiceIntegrationFactory.create_account_with_tenant(container_session)
        container_session.execute(delete(TenantAccountJoin))
        missing_account_id = str(uuid4())
        join = TenantAccountJoin(
            tenant_id=tenant.id,
            account_id=missing_account_id,
            role=TenantAccountRole.OWNER,
            current=True,
        )
        container_session.add(join)
        container_session.commit()

        with pytest.raises(AccountNotFoundError, match=missing_account_id):
            ScheduleService.get_tenant_owner(session=container_session, tenant_id=tenant.id)

    def test_get_tenant_owner_raises_when_no_owner_or_admin_found(self, container_session: Session):
        _account, tenant = ScheduleServiceIntegrationFactory.create_account_with_tenant(container_session)
        container_session.execute(delete(TenantAccountJoin))
        container_session.commit()

        with pytest.raises(AccountNotFoundError, match=tenant.id):
            ScheduleService.get_tenant_owner(session=container_session, tenant_id=tenant.id)

    def test_update_next_run_at_updates_persisted_value(self, container_session: Session):
        _account, tenant = ScheduleServiceIntegrationFactory.create_account_with_tenant(container_session)
        schedule = ScheduleServiceIntegrationFactory.create_schedule_plan(
            container_session,
            tenant_id=tenant.id,
        )
        expected_next_run = datetime(2026, 1, 3, 10, 30, 0)

        with pytest.MonkeyPatch.context() as monkeypatch:
            monkeypatch.setattr(
                "services.trigger.schedule_service.calculate_next_run_at",
                lambda *_args, **_kwargs: expected_next_run,
            )
            result = ScheduleService.update_next_run_at(
                session=container_session,
                schedule_id=schedule.id,
            )

        container_session.refresh(schedule)
        assert result == expected_next_run
        assert schedule.next_run_at == expected_next_run

    def test_update_next_run_at_raises_when_schedule_not_found(self, container_session: Session):
        with pytest.raises(ScheduleNotFoundError, match="Schedule not found"):
            ScheduleService.update_next_run_at(
                session=container_session,
                schedule_id=str(uuid4()),
            )


class TestSyncScheduleFromWorkflowIntegration:
    def test_sync_schedule_create_new(self, container_session: Session):
        _account, tenant = ScheduleServiceIntegrationFactory.create_account_with_tenant(container_session)
        app_id = str(uuid4())
        expected_next_run = datetime(2026, 1, 4, 10, 30, 0)

        with pytest.MonkeyPatch.context() as monkeypatch:
            monkeypatch.setattr(
                "services.trigger.schedule_service.calculate_next_run_at",
                lambda *_args, **_kwargs: expected_next_run,
            )
            result = sync_schedule_from_workflow(
                tenant_id=tenant.id,
                app_id=app_id,
                workflow=_cron_workflow(),
            )

        assert result is not None
        persisted = container_session.execute(
            select(WorkflowSchedulePlan).where(WorkflowSchedulePlan.app_id == app_id)
        ).scalar_one()
        assert persisted.node_id == "start"
        assert persisted.cron_expression == "30 10 * * *"
        assert persisted.timezone == "UTC"
        assert persisted.next_run_at == expected_next_run

    def test_sync_schedule_update_existing(self, container_session: Session):
        _account, tenant = ScheduleServiceIntegrationFactory.create_account_with_tenant(container_session)
        app_id = str(uuid4())
        existing = ScheduleServiceIntegrationFactory.create_schedule_plan(
            container_session,
            tenant_id=tenant.id,
            app_id=app_id,
            node_id="old-start",
            cron_expression="30 10 * * *",
            timezone="UTC",
        )
        existing_id = existing.id
        expected_next_run = datetime(2026, 1, 5, 12, 0, 0)

        with pytest.MonkeyPatch.context() as monkeypatch:
            monkeypatch.setattr(
                "services.trigger.schedule_service.calculate_next_run_at",
                lambda *_args, **_kwargs: expected_next_run,
            )
            result = sync_schedule_from_workflow(
                tenant_id=tenant.id,
                app_id=app_id,
                workflow=_cron_workflow(
                    node_id="start",
                    cron_expression="0 12 * * *",
                    timezone="America/New_York",
                ),
            )

        assert result is not None
        container_session.expire_all()
        persisted = container_session.get(WorkflowSchedulePlan, existing_id)
        assert persisted is not None
        assert persisted.node_id == "start"
        assert persisted.cron_expression == "0 12 * * *"
        assert persisted.timezone == "America/New_York"
        assert persisted.next_run_at == expected_next_run

    def test_sync_schedule_remove_when_no_config(self, container_session: Session):
        _account, tenant = ScheduleServiceIntegrationFactory.create_account_with_tenant(container_session)
        app_id = str(uuid4())
        existing = ScheduleServiceIntegrationFactory.create_schedule_plan(
            container_session,
            tenant_id=tenant.id,
            app_id=app_id,
        )
        existing_id = existing.id

        result = sync_schedule_from_workflow(
            tenant_id=tenant.id,
            app_id=app_id,
            workflow=_no_schedule_workflow(),
        )

        assert result is None
        container_session.expire_all()
        assert container_session.get(WorkflowSchedulePlan, existing_id) is None
