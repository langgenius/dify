import unittest
from datetime import UTC, datetime
from unittest.mock import MagicMock, Mock, patch

import pytest
from sqlalchemy.orm import Session

from core.workflow.nodes.trigger_schedule.entities import ScheduleConfig, SchedulePlanUpdate
from events.event_handlers.sync_workflow_schedule_when_app_published import (
    sync_schedule_from_workflow,
)
from libs.schedule_utils import calculate_next_run_at, convert_12h_to_24h
from models.account import Account, TenantAccountJoin
from models.workflow import Workflow, WorkflowSchedulePlan
from services.schedule_service import ScheduleService


class TestScheduleService(unittest.TestCase):
    """Test cases for ScheduleService class."""

    def test_calculate_next_run_at_valid_cron(self):
        """Test calculating next run time with valid cron expression."""
        # Test daily cron at 10:30 AM
        cron_expr = "30 10 * * *"
        timezone = "UTC"
        base_time = datetime(2025, 8, 29, 9, 0, 0, tzinfo=UTC)

        next_run = calculate_next_run_at(cron_expr, timezone, base_time)

        assert next_run is not None
        assert next_run.hour == 10
        assert next_run.minute == 30
        assert next_run.day == 29

    def test_calculate_next_run_at_with_timezone(self):
        """Test calculating next run time with different timezone."""
        cron_expr = "0 9 * * *"  # 9:00 AM
        timezone = "America/New_York"
        base_time = datetime(2025, 8, 29, 12, 0, 0, tzinfo=UTC)  # 8:00 AM EDT

        next_run = calculate_next_run_at(cron_expr, timezone, base_time)

        assert next_run is not None
        # 9:00 AM EDT = 13:00 UTC (during EDT)
        expected_utc_hour = 13
        assert next_run.hour == expected_utc_hour

    def test_calculate_next_run_at_with_last_day_of_month(self):
        """Test calculating next run time with 'L' (last day) syntax."""
        cron_expr = "0 10 L * *"  # 10:00 AM on last day of month
        timezone = "UTC"
        base_time = datetime(2025, 2, 15, 9, 0, 0, tzinfo=UTC)

        next_run = calculate_next_run_at(cron_expr, timezone, base_time)

        assert next_run is not None
        # February 2025 has 28 days
        assert next_run.day == 28
        assert next_run.month == 2

    def test_calculate_next_run_at_invalid_cron(self):
        """Test calculating next run time with invalid cron expression."""
        from croniter import CroniterBadCronError

        cron_expr = "invalid cron"
        timezone = "UTC"

        with pytest.raises(CroniterBadCronError):
            calculate_next_run_at(cron_expr, timezone)

    def test_calculate_next_run_at_invalid_timezone(self):
        """Test calculating next run time with invalid timezone."""
        from pytz import UnknownTimeZoneError

        cron_expr = "30 10 * * *"
        timezone = "Invalid/Timezone"

        with pytest.raises(UnknownTimeZoneError):
            calculate_next_run_at(cron_expr, timezone)

    @patch("libs.schedule_utils.calculate_next_run_at")
    def test_create_schedule(self, mock_calculate_next_run):
        """Test creating a new schedule."""
        mock_session = MagicMock(spec=Session)
        mock_calculate_next_run.return_value = datetime(2025, 8, 30, 10, 30, 0, tzinfo=UTC)

        config = ScheduleConfig(
            node_id="start",
            cron_expression="30 10 * * *",
            timezone="UTC",
        )

        schedule = ScheduleService.create_schedule(
            session=mock_session,
            tenant_id="test-tenant",
            app_id="test-app",
            config=config,
        )

        assert schedule is not None
        assert schedule.tenant_id == "test-tenant"
        assert schedule.app_id == "test-app"
        assert schedule.node_id == "start"
        assert schedule.cron_expression == "30 10 * * *"
        assert schedule.timezone == "UTC"
        assert schedule.next_run_at is not None
        mock_session.add.assert_called_once()
        mock_session.flush.assert_called_once()

    @patch("services.schedule_service.calculate_next_run_at")
    def test_update_schedule(self, mock_calculate_next_run):
        """Test updating an existing schedule."""
        mock_session = MagicMock(spec=Session)
        mock_schedule = Mock(spec=WorkflowSchedulePlan)
        mock_schedule.cron_expression = "0 12 * * *"
        mock_schedule.timezone = "America/New_York"
        mock_session.get.return_value = mock_schedule
        mock_calculate_next_run.return_value = datetime(2025, 8, 30, 12, 0, 0, tzinfo=UTC)

        updates = SchedulePlanUpdate(
            cron_expression="0 12 * * *",
            timezone="America/New_York",
        )

        result = ScheduleService.update_schedule(
            session=mock_session,
            schedule_id="test-schedule-id",
            updates=updates,
        )

        assert result is not None
        assert result.cron_expression == "0 12 * * *"
        assert result.timezone == "America/New_York"
        mock_calculate_next_run.assert_called_once()
        mock_session.flush.assert_called_once()

    def test_update_schedule_not_found(self):
        """Test updating a non-existent schedule raises exception."""
        from core.workflow.nodes.trigger_schedule.exc import ScheduleNotFoundError

        mock_session = MagicMock(spec=Session)
        mock_session.get.return_value = None

        updates = SchedulePlanUpdate(
            cron_expression="0 12 * * *",
        )

        with pytest.raises(ScheduleNotFoundError) as context:
            ScheduleService.update_schedule(
                session=mock_session,
                schedule_id="non-existent-id",
                updates=updates,
            )

        assert "Schedule not found: non-existent-id" in str(context.value)
        mock_session.flush.assert_not_called()

    def test_delete_schedule(self):
        """Test deleting a schedule."""
        mock_session = MagicMock(spec=Session)
        mock_schedule = Mock(spec=WorkflowSchedulePlan)
        mock_session.get.return_value = mock_schedule

        # Should not raise exception and complete successfully
        ScheduleService.delete_schedule(
            session=mock_session,
            schedule_id="test-schedule-id",
        )

        mock_session.delete.assert_called_once_with(mock_schedule)
        mock_session.flush.assert_called_once()

    def test_delete_schedule_not_found(self):
        """Test deleting a non-existent schedule raises exception."""
        from core.workflow.nodes.trigger_schedule.exc import ScheduleNotFoundError

        mock_session = MagicMock(spec=Session)
        mock_session.get.return_value = None

        # Should raise ScheduleNotFoundError
        with pytest.raises(ScheduleNotFoundError) as context:
            ScheduleService.delete_schedule(
                session=mock_session,
                schedule_id="non-existent-id",
            )

        assert "Schedule not found: non-existent-id" in str(context.value)
        mock_session.delete.assert_not_called()

    @patch("services.schedule_service.select")
    def test_get_tenant_owner(self, mock_select):
        """Test getting tenant owner account."""
        mock_session = MagicMock(spec=Session)
        mock_account = Mock(spec=Account)
        mock_account.id = "owner-account-id"

        # Mock owner query
        mock_owner_result = Mock(spec=TenantAccountJoin)
        mock_owner_result.account_id = "owner-account-id"

        mock_session.execute.return_value.scalar_one_or_none.return_value = mock_owner_result
        mock_session.get.return_value = mock_account

        result = ScheduleService.get_tenant_owner(
            session=mock_session,
            tenant_id="test-tenant",
        )

        assert result is not None
        assert result.id == "owner-account-id"

    @patch("services.schedule_service.select")
    def test_get_tenant_owner_fallback_to_admin(self, mock_select):
        """Test getting tenant owner falls back to admin if no owner."""
        mock_session = MagicMock(spec=Session)
        mock_account = Mock(spec=Account)
        mock_account.id = "admin-account-id"

        # Mock admin query (owner returns None)
        mock_admin_result = Mock(spec=TenantAccountJoin)
        mock_admin_result.account_id = "admin-account-id"

        mock_session.execute.return_value.scalar_one_or_none.side_effect = [None, mock_admin_result]
        mock_session.get.return_value = mock_account

        result = ScheduleService.get_tenant_owner(
            session=mock_session,
            tenant_id="test-tenant",
        )

        assert result is not None
        assert result.id == "admin-account-id"

    @patch("services.schedule_service.calculate_next_run_at")
    def test_update_next_run_at(self, mock_calculate_next_run):
        """Test updating next run time after schedule triggered."""
        mock_session = MagicMock(spec=Session)
        mock_schedule = Mock(spec=WorkflowSchedulePlan)
        mock_schedule.cron_expression = "30 10 * * *"
        mock_schedule.timezone = "UTC"
        mock_session.get.return_value = mock_schedule

        next_time = datetime(2025, 8, 31, 10, 30, 0, tzinfo=UTC)
        mock_calculate_next_run.return_value = next_time

        result = ScheduleService.update_next_run_at(
            session=mock_session,
            schedule_id="test-schedule-id",
        )

        assert result == next_time
        assert mock_schedule.next_run_at == next_time
        mock_session.flush.assert_called_once()


class TestVisualToCron(unittest.TestCase):
    """Test cases for visual configuration to cron conversion."""

    def test_visual_to_cron_hourly(self):
        """Test converting hourly visual config to cron."""
        visual_config = {"on_minute": 15}
        result = ScheduleService.visual_to_cron("hourly", visual_config)
        assert result == "15 * * * *"

    def test_visual_to_cron_daily(self):
        """Test converting daily visual config to cron."""
        visual_config = {"time": "2:30 PM"}
        result = ScheduleService.visual_to_cron("daily", visual_config)
        assert result == "30 14 * * *"

    def test_visual_to_cron_weekly(self):
        """Test converting weekly visual config to cron."""
        visual_config = {
            "time": "10:00 AM",
            "weekdays": ["mon", "wed", "fri"],
        }
        result = ScheduleService.visual_to_cron("weekly", visual_config)
        assert result == "0 10 * * 1,3,5"

    def test_visual_to_cron_monthly_with_specific_days(self):
        """Test converting monthly visual config with specific days."""
        visual_config = {
            "time": "11:30 AM",
            "monthly_days": [1, 15],
        }
        result = ScheduleService.visual_to_cron("monthly", visual_config)
        assert result == "30 11 1,15 * *"

    def test_visual_to_cron_monthly_with_last_day(self):
        """Test converting monthly visual config with last day using 'L' syntax."""
        visual_config = {
            "time": "11:30 AM",
            "monthly_days": [1, "last"],
        }
        result = ScheduleService.visual_to_cron("monthly", visual_config)
        assert result == "30 11 1,L * *"

    def test_visual_to_cron_monthly_only_last_day(self):
        """Test converting monthly visual config with only last day."""
        visual_config = {
            "time": "9:00 PM",
            "monthly_days": ["last"],
        }
        result = ScheduleService.visual_to_cron("monthly", visual_config)
        assert result == "0 21 L * *"

    def test_visual_to_cron_monthly_with_end_days_and_last(self):
        """Test converting monthly visual config with days 29, 30, 31 and 'last'."""
        visual_config = {
            "time": "3:45 PM",
            "monthly_days": [29, 30, 31, "last"],
        }
        result = ScheduleService.visual_to_cron("monthly", visual_config)
        # Should have 29,30,31,L - the L handles all possible last days
        assert result == "45 15 29,30,31,L * *"

    def test_visual_to_cron_invalid_frequency(self):
        """Test converting with invalid frequency."""
        result = ScheduleService.visual_to_cron("invalid", {})
        assert result is None

    def test_visual_to_cron_weekly_no_weekdays(self):
        """Test converting weekly with no weekdays specified."""
        visual_config = {"time": "10:00 AM"}
        result = ScheduleService.visual_to_cron("weekly", visual_config)
        assert result is None


class TestParseTime(unittest.TestCase):
    """Test cases for time parsing function."""

    def test_parse_time_am(self):
        """Test parsing AM time."""
        hour, minute = convert_12h_to_24h("9:30 AM")
        assert hour == 9
        assert minute == 30

    def test_parse_time_pm(self):
        """Test parsing PM time."""
        hour, minute = convert_12h_to_24h("2:45 PM")
        assert hour == 14
        assert minute == 45

    def test_parse_time_noon(self):
        """Test parsing 12:00 PM (noon)."""
        hour, minute = convert_12h_to_24h("12:00 PM")
        assert hour == 12
        assert minute == 0

    def test_parse_time_midnight(self):
        """Test parsing 12:00 AM (midnight)."""
        hour, minute = convert_12h_to_24h("12:00 AM")
        assert hour == 0
        assert minute == 0

    def test_parse_time_invalid_format(self):
        """Test parsing invalid time format."""
        hour, minute = convert_12h_to_24h("25:00")
        assert hour is None
        assert minute is None

    def test_parse_time_invalid_hour(self):
        """Test parsing invalid hour."""
        hour, minute = convert_12h_to_24h("13:00 PM")
        assert hour is None
        assert minute is None

    def test_parse_time_invalid_minute(self):
        """Test parsing invalid minute."""
        hour, minute = convert_12h_to_24h("10:60 AM")
        assert hour is None
        assert minute is None


class TestExtractScheduleConfig(unittest.TestCase):
    """Test cases for extracting schedule configuration from workflow."""

    def test_extract_schedule_config_with_cron_mode(self):
        """Test extracting schedule config in cron mode."""
        workflow = Mock(spec=Workflow)
        workflow.graph_dict = {
            "nodes": [
                {
                    "id": "schedule-node",
                    "data": {
                        "type": "trigger-schedule",
                        "mode": "cron",
                        "cron_expression": "0 10 * * *",
                        "timezone": "America/New_York",
                    },
                }
            ]
        }

        config = ScheduleService.extract_schedule_config(workflow)

        assert config is not None
        assert config.node_id == "schedule-node"
        assert config.cron_expression == "0 10 * * *"
        assert config.timezone == "America/New_York"

    def test_extract_schedule_config_with_visual_mode(self):
        """Test extracting schedule config in visual mode."""
        workflow = Mock(spec=Workflow)
        workflow.graph_dict = {
            "nodes": [
                {
                    "id": "schedule-node",
                    "data": {
                        "type": "trigger-schedule",
                        "mode": "visual",
                        "frequency": "daily",
                        "visual_config": {"time": "10:30 AM"},
                        "timezone": "UTC",
                    },
                }
            ]
        }

        config = ScheduleService.extract_schedule_config(workflow)

        assert config is not None
        assert config.node_id == "schedule-node"
        assert config.cron_expression == "30 10 * * *"
        assert config.timezone == "UTC"

    def test_extract_schedule_config_no_schedule_node(self):
        """Test extracting config when no schedule node exists."""
        workflow = Mock(spec=Workflow)
        workflow.graph_dict = {
            "nodes": [
                {
                    "id": "other-node",
                    "data": {"type": "llm"},
                }
            ]
        }

        config = ScheduleService.extract_schedule_config(workflow)
        assert config is None

    def test_extract_schedule_config_invalid_graph(self):
        """Test extracting config with invalid graph data."""
        workflow = Mock(spec=Workflow)
        workflow.graph_dict = None

        config = ScheduleService.extract_schedule_config(workflow)
        assert config is None


class TestScheduleWithTimezone(unittest.TestCase):
    """Test cases for schedule with timezone handling."""

    def test_visual_schedule_with_timezone_integration(self):
        """Test complete flow: visual config → cron → execution in different timezones.

        This test verifies that when a user in Shanghai sets a schedule for 10:30 AM,
        it runs at 10:30 AM Shanghai time, not 10:30 AM UTC.
        """
        # User in Shanghai wants to run a task at 10:30 AM local time
        visual_config = {
            "time": "10:30 AM",  # This is Shanghai time
            "monthly_days": [1],
        }

        # Convert to cron expression
        cron_expr = ScheduleService.visual_to_cron("monthly", visual_config)
        assert cron_expr is not None

        assert cron_expr == "30 10 1 * *"  # Direct conversion

        # Now test execution with Shanghai timezone
        shanghai_tz = "Asia/Shanghai"
        # Base time: 2025-01-01 00:00:00 UTC (08:00:00 Shanghai)
        base_time = datetime(2025, 1, 1, 0, 0, 0, tzinfo=UTC)

        next_run = calculate_next_run_at(cron_expr, shanghai_tz, base_time)

        assert next_run is not None

        # Should run at 10:30 AM Shanghai time on Jan 1
        # 10:30 AM Shanghai = 02:30 AM UTC (Shanghai is UTC+8)
        assert next_run.year == 2025
        assert next_run.month == 1
        assert next_run.day == 1
        assert next_run.hour == 2  # 02:30 UTC
        assert next_run.minute == 30

    def test_visual_schedule_different_timezones_same_local_time(self):
        """Test that same visual config in different timezones runs at different UTC times.

        This verifies that a schedule set for "9:00 AM" runs at 9 AM local time
        regardless of the timezone.
        """
        visual_config = {
            "time": "9:00 AM",
            "weekdays": ["mon"],
        }

        cron_expr = ScheduleService.visual_to_cron("weekly", visual_config)
        assert cron_expr is not None
        assert cron_expr == "0 9 * * 1"

        # Base time: Sunday 2025-01-05 12:00:00 UTC
        base_time = datetime(2025, 1, 5, 12, 0, 0, tzinfo=UTC)

        # Test New York (UTC-5 in January)
        ny_next = calculate_next_run_at(cron_expr, "America/New_York", base_time)
        assert ny_next is not None
        # Monday 9 AM EST = Monday 14:00 UTC
        assert ny_next.day == 6
        assert ny_next.hour == 14  # 9 AM EST = 2 PM UTC

        # Test Tokyo (UTC+9)
        tokyo_next = calculate_next_run_at(cron_expr, "Asia/Tokyo", base_time)
        assert tokyo_next is not None
        # Monday 9 AM JST = Monday 00:00 UTC
        assert tokyo_next.day == 6
        assert tokyo_next.hour == 0  # 9 AM JST = 0 AM UTC

    def test_visual_schedule_daily_across_dst_change(self):
        """Test that daily schedules adjust correctly during DST changes.

        A schedule set for "10:00 AM" should always run at 10 AM local time,
        even when DST changes.
        """
        visual_config = {
            "time": "10:00 AM",
        }

        cron_expr = ScheduleService.visual_to_cron("daily", visual_config)
        assert cron_expr is not None

        assert cron_expr == "0 10 * * *"

        # Test before DST (EST - UTC-5)
        winter_base = datetime(2025, 2, 1, 0, 0, 0, tzinfo=UTC)
        winter_next = calculate_next_run_at(cron_expr, "America/New_York", winter_base)
        assert winter_next is not None
        # 10 AM EST = 15:00 UTC
        assert winter_next.hour == 15

        # Test during DST (EDT - UTC-4)
        summer_base = datetime(2025, 6, 1, 0, 0, 0, tzinfo=UTC)
        summer_next = calculate_next_run_at(cron_expr, "America/New_York", summer_base)
        assert summer_next is not None
        # 10 AM EDT = 14:00 UTC
        assert summer_next.hour == 14


class TestSyncScheduleFromWorkflow(unittest.TestCase):
    """Test cases for syncing schedule from workflow."""

    @patch("events.event_handlers.sync_workflow_schedule_when_app_published.db")
    @patch("events.event_handlers.sync_workflow_schedule_when_app_published.ScheduleService")
    @patch("events.event_handlers.sync_workflow_schedule_when_app_published.select")
    def test_sync_schedule_create_new(self, mock_select, mock_service, mock_db):
        """Test creating new schedule when none exists."""
        mock_session = MagicMock()
        mock_db.engine = MagicMock()
        mock_session.__enter__ = MagicMock(return_value=mock_session)
        mock_session.__exit__ = MagicMock(return_value=None)
        Session = MagicMock(return_value=mock_session)
        with patch("events.event_handlers.sync_workflow_schedule_when_app_published.Session", Session):
            mock_session.scalar.return_value = None  # No existing plan

            # Mock extract_schedule_config to return a ScheduleConfig object
            mock_config = Mock(spec=ScheduleConfig)
            mock_config.node_id = "start"
            mock_config.cron_expression = "30 10 * * *"
            mock_config.timezone = "UTC"
            mock_service.extract_schedule_config.return_value = mock_config

            mock_new_plan = Mock(spec=WorkflowSchedulePlan)
            mock_service.create_schedule.return_value = mock_new_plan

            workflow = Mock(spec=Workflow)
            result = sync_schedule_from_workflow("tenant-id", "app-id", workflow)

            assert result == mock_new_plan
            mock_service.create_schedule.assert_called_once()
            mock_session.commit.assert_called_once()

    @patch("events.event_handlers.sync_workflow_schedule_when_app_published.db")
    @patch("events.event_handlers.sync_workflow_schedule_when_app_published.ScheduleService")
    @patch("events.event_handlers.sync_workflow_schedule_when_app_published.select")
    def test_sync_schedule_update_existing(self, mock_select, mock_service, mock_db):
        """Test updating existing schedule."""
        mock_session = MagicMock()
        mock_db.engine = MagicMock()
        mock_session.__enter__ = MagicMock(return_value=mock_session)
        mock_session.__exit__ = MagicMock(return_value=None)
        Session = MagicMock(return_value=mock_session)

        with patch("events.event_handlers.sync_workflow_schedule_when_app_published.Session", Session):
            mock_existing_plan = Mock(spec=WorkflowSchedulePlan)
            mock_existing_plan.id = "existing-plan-id"
            mock_session.scalar.return_value = mock_existing_plan

            # Mock extract_schedule_config to return a ScheduleConfig object
            mock_config = Mock(spec=ScheduleConfig)
            mock_config.node_id = "start"
            mock_config.cron_expression = "0 12 * * *"
            mock_config.timezone = "America/New_York"
            mock_service.extract_schedule_config.return_value = mock_config

            mock_updated_plan = Mock(spec=WorkflowSchedulePlan)
            mock_service.update_schedule.return_value = mock_updated_plan

            workflow = Mock(spec=Workflow)
            result = sync_schedule_from_workflow("tenant-id", "app-id", workflow)

            assert result == mock_updated_plan
            mock_service.update_schedule.assert_called_once()
            # Verify the arguments passed to update_schedule
            call_args = mock_service.update_schedule.call_args
            assert call_args.kwargs["session"] == mock_session
            assert call_args.kwargs["schedule_id"] == "existing-plan-id"
            updates_obj = call_args.kwargs["updates"]
            assert isinstance(updates_obj, SchedulePlanUpdate)
            assert updates_obj.node_id == "start"
            assert updates_obj.cron_expression == "0 12 * * *"
            assert updates_obj.timezone == "America/New_York"
            mock_session.commit.assert_called_once()

    @patch("events.event_handlers.sync_workflow_schedule_when_app_published.db")
    @patch("events.event_handlers.sync_workflow_schedule_when_app_published.ScheduleService")
    @patch("events.event_handlers.sync_workflow_schedule_when_app_published.select")
    def test_sync_schedule_remove_when_no_config(self, mock_select, mock_service, mock_db):
        """Test removing schedule when no schedule config in workflow."""
        mock_session = MagicMock()
        mock_db.engine = MagicMock()
        mock_session.__enter__ = MagicMock(return_value=mock_session)
        mock_session.__exit__ = MagicMock(return_value=None)
        Session = MagicMock(return_value=mock_session)

        with patch("events.event_handlers.sync_workflow_schedule_when_app_published.Session", Session):
            mock_existing_plan = Mock(spec=WorkflowSchedulePlan)
            mock_existing_plan.id = "existing-plan-id"
            mock_session.scalar.return_value = mock_existing_plan

            mock_service.extract_schedule_config.return_value = None  # No schedule config

            workflow = Mock(spec=Workflow)
            result = sync_schedule_from_workflow("tenant-id", "app-id", workflow)

            assert result is None
            # Now using ScheduleService.delete_schedule instead of session.delete
            mock_service.delete_schedule.assert_called_once_with(session=mock_session, schedule_id="existing-plan-id")
            mock_session.commit.assert_called_once()


if __name__ == "__main__":
    unittest.main()
