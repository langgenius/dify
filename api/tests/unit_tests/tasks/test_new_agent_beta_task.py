from datetime import UTC, datetime
from typing import Protocol, cast
from unittest.mock import MagicMock

import pytest
from sqlalchemy.orm import Session

from enums import DeploymentEdition
from models.agent import AgentConfigRevision, AgentConfigRevisionOperation
from services.billing_service import BillingService
from tasks import new_agent_beta_task as task_module
from tasks.new_agent_beta_task import (
    NEW_AGENT_BETA_QUEUE,
    ensure_new_agent_beta_participation_task,
    register_new_agent_beta_publish_after_commit,
    schedule_new_agent_beta_ensure,
)


class _TaskWithQueue(Protocol):
    queue: str


def _configure_cloud_publish(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(task_module.dify_config, "DEPLOYMENT_EDITION", DeploymentEdition.CLOUD)
    monkeypatch.setattr(task_module.dify_config, "NEW_AGENT_BETA_ACTIVITY_START_AT", datetime(2026, 8, 12, tzinfo=UTC))
    monkeypatch.setattr(task_module.dify_config, "NEW_AGENT_BETA_ACTIVITY_END_AT", datetime(2026, 8, 13, tzinfo=UTC))


@pytest.mark.parametrize("sqlite_session", [(AgentConfigRevision,)], indirect=True)
def test_publish_event_is_dispatched_only_after_commit(
    monkeypatch: pytest.MonkeyPatch, sqlite_session: Session
) -> None:
    published_at = datetime(2026, 8, 12, 1, 0)
    _configure_cloud_publish(monkeypatch)
    revision = AgentConfigRevision(
        id="revision-1",
        tenant_id="tenant-1",
        agent_id="agent-1",
        current_snapshot_id="snapshot-1",
        revision=1,
        operation=AgentConfigRevisionOperation.PUBLISH_DRAFT,
        created_at=published_at,
    )
    sqlite_session.add(revision)
    sqlite_session.flush()
    dispatch = MagicMock()
    monkeypatch.setattr(task_module, "schedule_new_agent_beta_ensure", dispatch)

    register_new_agent_beta_publish_after_commit(
        session=sqlite_session,
        tenant_id="tenant-1",
        agent_id="agent-1",
        snapshot_id="snapshot-1",
    )

    dispatch.assert_not_called()
    sqlite_session.commit()
    dispatch.assert_called_once_with("revision-1")


@pytest.mark.parametrize("sqlite_session", [(AgentConfigRevision,)], indirect=True)
def test_rolled_back_publish_is_never_dispatched(monkeypatch: pytest.MonkeyPatch, sqlite_session: Session) -> None:
    published_at = datetime(2026, 8, 12, 1, 0)
    _configure_cloud_publish(monkeypatch)
    sqlite_session.add(
        AgentConfigRevision(
            id="revision-1",
            tenant_id="tenant-1",
            agent_id="agent-1",
            current_snapshot_id="snapshot-1",
            revision=1,
            operation=AgentConfigRevisionOperation.PUBLISH_DRAFT,
            created_at=published_at,
        )
    )
    sqlite_session.flush()
    dispatch = MagicMock()
    monkeypatch.setattr(task_module, "schedule_new_agent_beta_ensure", dispatch)

    register_new_agent_beta_publish_after_commit(
        session=sqlite_session,
        tenant_id="tenant-1",
        agent_id="agent-1",
        snapshot_id="snapshot-1",
    )
    sqlite_session.rollback()
    sqlite_session.commit()

    dispatch.assert_not_called()


def test_non_cloud_publish_skips_revision_lookup(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(task_module.dify_config, "DEPLOYMENT_EDITION", DeploymentEdition.COMMUNITY)
    session = MagicMock()

    register_new_agent_beta_publish_after_commit(
        session=session,
        tenant_id="tenant-1",
        agent_id="agent-1",
        snapshot_id="snapshot-1",
    )

    session.scalar.assert_not_called()


@pytest.mark.parametrize(
    ("start", "end", "published_at", "expected"),
    [
        (datetime(2026, 8, 12, tzinfo=UTC), datetime(2026, 8, 13, tzinfo=UTC), datetime(2026, 8, 12), True),
        (datetime(2026, 8, 12, tzinfo=UTC), datetime(2026, 8, 13, tzinfo=UTC), datetime(2026, 8, 13), False),
        (None, datetime(2026, 8, 13, tzinfo=UTC), datetime(2026, 8, 12), False),
        (datetime(2026, 8, 13, tzinfo=UTC), datetime(2026, 8, 12, tzinfo=UTC), datetime(2026, 8, 12), False),
    ],
)
def test_publish_activity_window_is_inclusive_start_exclusive_end(
    monkeypatch: pytest.MonkeyPatch,
    start: datetime | None,
    end: datetime | None,
    published_at: datetime,
    expected: bool,
) -> None:
    monkeypatch.setattr(task_module.dify_config, "NEW_AGENT_BETA_ACTIVITY_START_AT", start)
    monkeypatch.setattr(task_module.dify_config, "NEW_AGENT_BETA_ACTIVITY_END_AT", end)

    assert task_module._is_publish_in_activity_window(published_at) is expected


def test_broker_failure_does_not_propagate(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(
        ensure_new_agent_beta_participation_task,
        "delay",
        MagicMock(side_effect=RuntimeError("broker unavailable")),
    )

    schedule_new_agent_beta_ensure("revision-1")


def test_task_calls_billing_with_revision_id(monkeypatch: pytest.MonkeyPatch) -> None:
    ensure = MagicMock()
    monkeypatch.setattr(BillingService, "ensure_new_agent_beta_revision", ensure)

    ensure_new_agent_beta_participation_task.run("revision-1")

    ensure.assert_called_once_with("revision-1")


def test_task_is_redelivered_when_worker_is_lost() -> None:
    task = cast(_TaskWithQueue, ensure_new_agent_beta_participation_task)

    assert task.queue == NEW_AGENT_BETA_QUEUE
    assert ensure_new_agent_beta_participation_task.acks_late is True
    assert ensure_new_agent_beta_participation_task.reject_on_worker_lost is True
    assert ensure_new_agent_beta_participation_task.max_retries == 8


def test_task_retries_billing_failure(monkeypatch: pytest.MonkeyPatch) -> None:
    error = RuntimeError("billing unavailable")
    monkeypatch.setattr(BillingService, "ensure_new_agent_beta_revision", MagicMock(side_effect=error))
    retry = MagicMock(side_effect=RuntimeError("retry scheduled"))
    monkeypatch.setattr(ensure_new_agent_beta_participation_task, "retry", retry)

    with pytest.raises(RuntimeError, match="retry scheduled"):
        ensure_new_agent_beta_participation_task.run("revision-1")

    retry.assert_called_once_with(exc=error, countdown=30)


def test_task_caps_exponential_retry_delay(monkeypatch: pytest.MonkeyPatch) -> None:
    error = RuntimeError("billing unavailable")
    monkeypatch.setattr(BillingService, "ensure_new_agent_beta_revision", MagicMock(side_effect=error))
    monkeypatch.setattr(ensure_new_agent_beta_participation_task.request, "retries", 7)
    retry = MagicMock(side_effect=RuntimeError("retry scheduled"))
    monkeypatch.setattr(ensure_new_agent_beta_participation_task, "retry", retry)

    with pytest.raises(RuntimeError, match="retry scheduled"):
        ensure_new_agent_beta_participation_task.run("revision-1")

    retry.assert_called_once_with(exc=error, countdown=900)


def test_billing_contract_uses_internal_ensure_endpoint(monkeypatch: pytest.MonkeyPatch) -> None:
    send_request = MagicMock(return_value={"status": "issued"})
    monkeypatch.setattr(BillingService, "_send_request", send_request)

    BillingService.ensure_new_agent_beta_revision("revision-1")

    send_request.assert_called_once_with(
        "POST",
        "/new-agent-beta/revisions/revision-1/ensure",
    )
