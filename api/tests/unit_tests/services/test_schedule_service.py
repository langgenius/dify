from datetime import UTC, datetime
from types import SimpleNamespace
from typing import Any, cast
from unittest.mock import MagicMock

import pytest
from sqlalchemy.orm import Session

from dify_graph.nodes import NodeType
from dify_graph.nodes.trigger_schedule.entities import ScheduleConfig, SchedulePlanUpdate, VisualConfig
from dify_graph.nodes.trigger_schedule.exc import ScheduleConfigError, ScheduleNotFoundError
from models.trigger import WorkflowSchedulePlan
from models.workflow import Workflow
from services.errors.account import AccountNotFoundError
from services.trigger import schedule_service as service_module
from services.trigger.schedule_service import ScheduleService


@pytest.fixture
def session_mock() -> MagicMock:
    return MagicMock(spec=Session)


def _workflow(**kwargs: Any) -> Workflow:
    return cast(Workflow, SimpleNamespace(**kwargs))


def test_create_schedule_should_create_and_flush_schedule(
    session_mock: MagicMock, monkeypatch: pytest.MonkeyPatch
) -> None:
    # Arrange
    next_run = datetime(2026, 1, 1, 0, 0, tzinfo=UTC)
    monkeypatch.setattr(service_module, "calculate_next_run_at", MagicMock(return_value=next_run))
    config = ScheduleConfig(node_id="node-1", cron_expression="0 12 * * *", timezone="UTC")

    # Act
    result = ScheduleService.create_schedule(session=session_mock, tenant_id="tenant-1", app_id="app-1", config=config)

    # Assert
    assert result.tenant_id == "tenant-1"
    assert result.app_id == "app-1"
    assert result.node_id == "node-1"
    assert result.next_run_at == next_run
    session_mock.add.assert_called_once_with(result)
    session_mock.flush.assert_called_once()


def test_update_schedule_should_raise_when_schedule_not_found(session_mock: MagicMock) -> None:
    # Arrange
    session_mock.get.return_value = None

    # Act / Assert
    with pytest.raises(ScheduleNotFoundError, match="Schedule not found: schedule-1"):
        ScheduleService.update_schedule(
            session=session_mock,
            schedule_id="schedule-1",
            updates=SchedulePlanUpdate(cron_expression="*/5 * * * *"),
        )


def test_update_schedule_should_update_only_node_id_without_recomputing_time(
    session_mock: MagicMock,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    # Arrange
    schedule = MagicMock(spec=WorkflowSchedulePlan)
    schedule.cron_expression = "0 10 * * *"
    schedule.timezone = "UTC"
    session_mock.get.return_value = schedule

    next_run_mock = MagicMock(return_value=datetime(2026, 1, 1, 10, 0, tzinfo=UTC))
    monkeypatch.setattr(service_module, "calculate_next_run_at", next_run_mock)

    # Act
    result = ScheduleService.update_schedule(
        session=session_mock,
        schedule_id="schedule-1",
        updates=SchedulePlanUpdate(node_id="node-new"),
    )

    # Assert
    assert result is schedule
    assert schedule.node_id == "node-new"
    next_run_mock.assert_not_called()
    session_mock.flush.assert_called_once()


def test_update_schedule_should_update_time_fields_and_recompute_next_run_at(
    session_mock: MagicMock,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    # Arrange
    schedule = MagicMock(spec=WorkflowSchedulePlan)
    schedule.cron_expression = "0 10 * * *"
    schedule.timezone = "UTC"
    session_mock.get.return_value = schedule

    next_run = datetime(2026, 1, 2, 10, 0, tzinfo=UTC)
    next_run_mock = MagicMock(return_value=next_run)
    monkeypatch.setattr(service_module, "calculate_next_run_at", next_run_mock)

    # Act
    result = ScheduleService.update_schedule(
        session=session_mock,
        schedule_id="schedule-1",
        updates=SchedulePlanUpdate(cron_expression="0 8 * * *", timezone="Asia/Kolkata"),
    )

    # Assert
    assert result is schedule
    assert schedule.cron_expression == "0 8 * * *"
    assert schedule.timezone == "Asia/Kolkata"
    assert schedule.next_run_at == next_run
    next_run_mock.assert_called_once_with("0 8 * * *", "Asia/Kolkata")


def test_delete_schedule_should_raise_when_schedule_missing(session_mock: MagicMock) -> None:
    # Arrange
    session_mock.get.return_value = None

    # Act / Assert
    with pytest.raises(ScheduleNotFoundError, match="Schedule not found: schedule-1"):
        ScheduleService.delete_schedule(session=session_mock, schedule_id="schedule-1")


def test_delete_schedule_should_delete_and_flush(session_mock: MagicMock) -> None:
    # Arrange
    schedule = MagicMock(spec=WorkflowSchedulePlan)
    session_mock.get.return_value = schedule

    # Act
    ScheduleService.delete_schedule(session=session_mock, schedule_id="schedule-1")

    # Assert
    session_mock.delete.assert_called_once_with(schedule)
    session_mock.flush.assert_called_once()


def test_get_tenant_owner_should_return_owner_account(session_mock: MagicMock) -> None:
    # Arrange
    owner_join = SimpleNamespace(account_id="account-1")
    session_mock.execute.return_value.scalar_one_or_none.return_value = owner_join
    account = SimpleNamespace(id="account-1")
    session_mock.get.return_value = account

    # Act
    result = ScheduleService.get_tenant_owner(session=session_mock, tenant_id="tenant-1")

    # Assert
    assert result is account


def test_get_tenant_owner_should_fallback_to_admin_when_owner_missing(session_mock: MagicMock) -> None:
    # Arrange
    admin_join = SimpleNamespace(account_id="account-2")
    session_mock.execute.return_value.scalar_one_or_none.side_effect = [None, admin_join]
    account = SimpleNamespace(id="account-2")
    session_mock.get.return_value = account

    # Act
    result = ScheduleService.get_tenant_owner(session=session_mock, tenant_id="tenant-1")

    # Assert
    assert result is account


def test_get_tenant_owner_should_raise_when_account_record_missing(session_mock: MagicMock) -> None:
    # Arrange
    join = SimpleNamespace(account_id="account-404")
    session_mock.execute.return_value.scalar_one_or_none.return_value = join
    session_mock.get.return_value = None

    # Act / Assert
    with pytest.raises(AccountNotFoundError, match="Account not found: account-404"):
        ScheduleService.get_tenant_owner(session=session_mock, tenant_id="tenant-1")


def test_get_tenant_owner_should_raise_when_no_owner_or_admin_found(session_mock: MagicMock) -> None:
    # Arrange
    session_mock.execute.return_value.scalar_one_or_none.side_effect = [None, None]

    # Act / Assert
    with pytest.raises(AccountNotFoundError, match="Account not found for tenant: tenant-1"):
        ScheduleService.get_tenant_owner(session=session_mock, tenant_id="tenant-1")


def test_update_next_run_at_should_raise_when_schedule_not_found(session_mock: MagicMock) -> None:
    # Arrange
    session_mock.get.return_value = None

    # Act / Assert
    with pytest.raises(ScheduleNotFoundError, match="Schedule not found: schedule-1"):
        ScheduleService.update_next_run_at(session=session_mock, schedule_id="schedule-1")


def test_update_next_run_at_should_recompute_and_flush(
    session_mock: MagicMock, monkeypatch: pytest.MonkeyPatch
) -> None:
    # Arrange
    schedule = MagicMock(spec=WorkflowSchedulePlan)
    schedule.cron_expression = "0 9 * * *"
    schedule.timezone = "UTC"
    session_mock.get.return_value = schedule

    expected = datetime(2026, 1, 3, 9, 0, tzinfo=UTC)
    monkeypatch.setattr(service_module, "calculate_next_run_at", MagicMock(return_value=expected))

    # Act
    result = ScheduleService.update_next_run_at(session=session_mock, schedule_id="schedule-1")

    # Assert
    assert result == expected
    assert schedule.next_run_at == expected
    session_mock.flush.assert_called_once()


def test_to_schedule_config_should_build_from_cron_mode() -> None:
    # Arrange
    node_config: dict[str, Any] = {
        "id": "node-1",
        "data": {
            "mode": "cron",
            "cron_expression": "0 12 * * *",
            "timezone": "Asia/Kolkata",
        },
    }

    # Act
    result = ScheduleService.to_schedule_config(node_config=node_config)

    # Assert
    assert result.node_id == "node-1"
    assert result.cron_expression == "0 12 * * *"
    assert result.timezone == "Asia/Kolkata"


def test_to_schedule_config_should_raise_for_cron_mode_without_expression() -> None:
    # Arrange
    node_config = {"id": "node-1", "data": {"mode": "cron", "cron_expression": ""}}

    # Act / Assert
    with pytest.raises(ScheduleConfigError, match="Cron expression is required for cron mode"):
        ScheduleService.to_schedule_config(node_config=node_config)


def test_to_schedule_config_should_build_from_visual_mode(monkeypatch: pytest.MonkeyPatch) -> None:
    # Arrange
    node_config = {
        "id": "node-1",
        "data": {
            "mode": "visual",
            "frequency": "daily",
            "visual_config": {"time": "9:30 AM"},
            "timezone": "UTC",
        },
    }
    monkeypatch.setattr(ScheduleService, "visual_to_cron", MagicMock(return_value="30 9 * * *"))

    # Act
    result = ScheduleService.to_schedule_config(node_config=node_config)

    # Assert
    assert result.cron_expression == "30 9 * * *"


def test_to_schedule_config_should_raise_for_invalid_mode() -> None:
    # Arrange
    node_config = {"id": "node-1", "data": {"mode": "manual"}}

    # Act / Assert
    with pytest.raises(ScheduleConfigError, match="Invalid schedule mode: manual"):
        ScheduleService.to_schedule_config(node_config=node_config)


def test_extract_schedule_config_should_return_none_when_no_schedule_node() -> None:
    # Arrange
    workflow = _workflow(graph_dict={"nodes": [{"id": "n1", "data": {"type": "start"}}]})

    # Act
    result = ScheduleService.extract_schedule_config(workflow=workflow)

    # Assert
    assert result is None


def test_extract_schedule_config_should_parse_cron_mode_node() -> None:
    # Arrange
    workflow = _workflow(
        graph_dict={
            "nodes": [
                {
                    "id": "schedule-1",
                    "data": {
                        "type": NodeType.TRIGGER_SCHEDULE.value,
                        "mode": "cron",
                        "cron_expression": "5 8 * * *",
                        "timezone": "UTC",
                    },
                }
            ]
        }
    )

    # Act
    result = ScheduleService.extract_schedule_config(workflow=workflow)

    # Assert
    assert result is not None
    assert result.node_id == "schedule-1"
    assert result.cron_expression == "5 8 * * *"


def test_extract_schedule_config_should_parse_visual_mode_node(monkeypatch: pytest.MonkeyPatch) -> None:
    # Arrange
    workflow = _workflow(
        graph_dict={
            "nodes": [
                {
                    "id": "schedule-1",
                    "data": {
                        "type": NodeType.TRIGGER_SCHEDULE.value,
                        "mode": "visual",
                        "frequency": "weekly",
                        "visual_config": {"time": "10:00 AM", "weekdays": ["mon"]},
                        "timezone": "UTC",
                    },
                }
            ]
        }
    )
    monkeypatch.setattr(ScheduleService, "visual_to_cron", MagicMock(return_value="0 10 * * 1"))

    # Act
    result = ScheduleService.extract_schedule_config(workflow=workflow)

    # Assert
    assert result is not None
    assert result.cron_expression == "0 10 * * 1"


def test_extract_schedule_config_should_raise_when_graph_is_empty() -> None:
    # Arrange
    workflow = _workflow(graph_dict={})

    # Act / Assert
    with pytest.raises(ScheduleConfigError, match="Workflow graph is empty"):
        ScheduleService.extract_schedule_config(workflow=workflow)


def test_extract_schedule_config_should_raise_when_mode_invalid() -> None:
    # Arrange
    workflow = _workflow(
        graph_dict={
            "nodes": [
                {
                    "id": "schedule-1",
                    "data": {
                        "type": NodeType.TRIGGER_SCHEDULE.value,
                        "mode": "invalid",
                    },
                }
            ]
        }
    )

    # Act / Assert
    with pytest.raises(ScheduleConfigError, match="Invalid schedule mode: invalid"):
        ScheduleService.extract_schedule_config(workflow=workflow)


@pytest.mark.parametrize(
    ("frequency", "visual_config", "expected"),
    [
        ("hourly", VisualConfig(on_minute=5), "5 * * * *"),
        ("daily", VisualConfig(time="2:30 PM"), "30 14 * * *"),
        ("weekly", VisualConfig(time="8:00 AM", weekdays=["wed", "mon"]), "0 8 * * 1,3"),
        ("monthly", VisualConfig(time="9:15 AM", monthly_days=[15, 1, "last", 1]), "15 9 1,15,L * *"),
    ],
)
def test_visual_to_cron_should_convert_frequency_configs(
    frequency: str,
    visual_config: VisualConfig,
    expected: str,
) -> None:
    # Arrange

    # Act
    result = ScheduleService.visual_to_cron(frequency=frequency, visual_config=visual_config)

    # Assert
    assert result == expected


@pytest.mark.parametrize(
    ("frequency", "visual_config", "error_message"),
    [
        ("hourly", VisualConfig(on_minute=None), "on_minute is required for hourly schedules"),
        ("daily", VisualConfig(time=None), "time is required for daily schedules"),
        ("weekly", VisualConfig(time=None, weekdays=["mon"]), "time is required for weekly schedules"),
        (
            "weekly",
            VisualConfig(time="9:00 AM", weekdays=None),
            "Weekdays are required for weekly schedules",
        ),
        ("monthly", VisualConfig(time=None, monthly_days=[1]), "time is required for monthly schedules"),
        (
            "monthly",
            VisualConfig(time="9:00 AM", monthly_days=None),
            "Monthly days are required for monthly schedules",
        ),
        ("yearly", VisualConfig(time="9:00 AM"), "Unsupported frequency: yearly"),
    ],
)
def test_visual_to_cron_should_raise_for_invalid_visual_inputs(
    frequency: str,
    visual_config: VisualConfig,
    error_message: str,
) -> None:
    # Arrange

    # Act / Assert
    with pytest.raises(ScheduleConfigError, match=error_message):
        ScheduleService.visual_to_cron(frequency=frequency, visual_config=visual_config)
