import logging
from datetime import UTC, datetime
from typing import Optional

import pytz
from croniter import croniter
from sqlalchemy import select
from sqlalchemy.orm import Session

from models.account import Account, TenantAccountJoin
from models.workflow import WorkflowSchedulePlan

logger = logging.getLogger(__name__)


class ScheduleService:
    @staticmethod
    def calculate_next_run_at(
        cron_expression: str,
        timezone: str,
        base_time: Optional[datetime] = None,
    ) -> Optional[datetime]:
        try:
            tz = pytz.timezone(timezone)
            if base_time is None:
                base_time = datetime.now(UTC)
            base_time_tz = base_time.astimezone(tz)
            cron = croniter(cron_expression, base_time_tz)
            next_run_tz = cron.get_next(datetime)
            next_run_utc = next_run_tz.astimezone(UTC)
            return next_run_utc
        except Exception:
            logger.exception("Error calculating next run time")
            return None

    @staticmethod
    def create_schedule(
        session: Session,
        tenant_id: str,
        app_id: str,
        node_id: str,
        cron_expression: str,
        timezone: str,
    ) -> WorkflowSchedulePlan:
        """
        Create a new workflow schedule.

        Args:
            session: Database session
            tenant_id: Tenant ID
            app_id: Application ID
            node_id: Starting node ID
            cron_expression: Cron expression
            timezone: Timezone for cron evaluation

        Returns:
            Created WorkflowSchedulePlan instance
        """
        # Calculate initial next run time
        next_run_at = ScheduleService.calculate_next_run_at(
            cron_expression,
            timezone,
        )

        # Create schedule record
        schedule = WorkflowSchedulePlan(
            tenant_id=tenant_id,
            app_id=app_id,
            node_id=node_id,
            cron_expression=cron_expression,
            timezone=timezone,
            next_run_at=next_run_at,
        )

        session.add(schedule)
        session.flush()

        return schedule

    @staticmethod
    def update_schedule(
        session: Session,
        schedule_id: str,
        updates: dict,
    ) -> Optional[WorkflowSchedulePlan]:
        """
        Update a schedule with the provided changes.

        Args:
            session: Database session
            schedule_id: Schedule ID to update
            updates: Dictionary of fields to update

        Returns:
            Updated schedule or None if not found
        """
        schedule = session.get(WorkflowSchedulePlan, schedule_id)
        if not schedule:
            return None

        # Apply updates
        for field, value in updates.items():
            if hasattr(schedule, field):
                setattr(schedule, field, value)

        # Recalculate next_run_at if schedule parameters changed
        if any(field in updates for field in ["cron_expression", "timezone"]):
            next_run_at = ScheduleService.calculate_next_run_at(
                schedule.cron_expression,
                schedule.timezone,
            )
            schedule.next_run_at = next_run_at

        session.flush()
        return schedule

    @staticmethod
    def delete_schedule(
        session: Session,
        schedule_id: str,
    ) -> bool:
        """
        Delete a schedule.

        Args:
            session: Database session
            schedule_id: Schedule ID to delete

        Returns:
            True if deleted, False if not found
        """
        schedule = session.get(WorkflowSchedulePlan, schedule_id)
        if not schedule:
            return False

        session.delete(schedule)
        session.flush()
        return True

    @staticmethod
    def get_tenant_owner(session: Session, tenant_id: str) -> Optional[Account]:
        """
        Get the owner account for a tenant.
        Used to execute scheduled workflows on behalf of the tenant owner.

        Args:
            session: Database session
            tenant_id: Tenant ID

        Returns:
            Owner Account or None
        """
        # Query for owner role in tenant
        result = session.execute(
            select(TenantAccountJoin)
            .where(TenantAccountJoin.tenant_id == tenant_id, TenantAccountJoin.role == "owner")
            .limit(1)
        ).scalar_one_or_none()

        if not result:
            # Fallback to any admin if no owner
            result = session.execute(
                select(TenantAccountJoin)
                .where(TenantAccountJoin.tenant_id == tenant_id, TenantAccountJoin.role == "admin")
                .limit(1)
            ).scalar_one_or_none()

        if result:
            return session.get(Account, result.account_id)

        return None

    @staticmethod
    def update_next_run_at(
        session: Session,
        schedule_id: str,
    ) -> Optional[datetime]:
        """
        Calculate and update the next run time for a schedule.
        Used after a schedule has been triggered.

        Args:
            session: Database session
            schedule_id: Schedule ID

        Returns:
            New next_run_at datetime or None
        """
        schedule = session.get(WorkflowSchedulePlan, schedule_id)
        if not schedule:
            return None

        # Calculate next run time
        next_run_at = ScheduleService.calculate_next_run_at(
            schedule.cron_expression,
            schedule.timezone,
            base_time=datetime.now(UTC),  # Use current time as base
        )

        # Update schedule
        schedule.next_run_at = next_run_at
        session.flush()
        return next_run_at
