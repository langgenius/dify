import logging

from sqlalchemy import select
from sqlalchemy.orm import Session

from core.workflow.nodes.trigger_schedule.entities import (
    ScheduleConfig,
    TriggerScheduleNodeData,
    VisualConfig,
)
from core.workflow.nodes.trigger_schedule.exc import ScheduleConfigError
from graphon.entities.graph_config import NodeConfigDict
from models.account import Account, TenantAccountJoin
from services.account_errors import AccountNotFoundError
from services.trigger.schedule_policy import visual_to_cron

logger = logging.getLogger(__name__)


class ScheduleService:
    @staticmethod
    def get_tenant_owner(tenant_id: str, *, session: Session) -> Account:
        """
        Returns an account to execute scheduled workflows on behalf of the tenant.
        Prioritizes owner over admin to ensure proper authorization hierarchy.
        """
        result = session.execute(
            select(TenantAccountJoin)
            .where(TenantAccountJoin.tenant_id == tenant_id, TenantAccountJoin.role == "owner")
            .limit(1)
        ).scalar_one_or_none()

        if not result:
            # Owner may not exist in some tenant configurations, fallback to admin
            result = session.execute(
                select(TenantAccountJoin)
                .where(TenantAccountJoin.tenant_id == tenant_id, TenantAccountJoin.role == "admin")
                .limit(1)
            ).scalar_one_or_none()

        if result:
            account = session.get(Account, result.account_id)
            if not account:
                raise AccountNotFoundError(f"Account not found: {result.account_id}")
            return account
        else:
            raise AccountNotFoundError(f"Account not found for tenant: {tenant_id}")

    @staticmethod
    def to_schedule_config(node_config: NodeConfigDict) -> ScheduleConfig:
        """
        Converts user-friendly visual schedule settings to cron expression.
        Maintains consistency with frontend UI expectations while supporting croniter's extended syntax.
        """
        node_data = TriggerScheduleNodeData.model_validate(node_config["data"], from_attributes=True)
        mode = node_data.mode
        timezone = node_data.timezone
        node_id = node_config["id"]

        cron_expression = None
        if mode == "cron":
            cron_expression = node_data.cron_expression
            if not cron_expression:
                raise ScheduleConfigError("Cron expression is required for cron mode")
        elif mode == "visual":
            frequency = str(node_data.frequency or "")
            if not frequency:
                raise ScheduleConfigError("Frequency is required for visual mode")
            visual_config = VisualConfig.model_validate(node_data.visual_config or {})
            cron_expression = visual_to_cron(frequency=frequency, visual_config=visual_config)
            if not cron_expression:
                raise ScheduleConfigError("Cron expression is required for visual mode")
        else:
            raise ScheduleConfigError(f"Invalid schedule mode: {mode}")
        return ScheduleConfig(node_id=node_id, cron_expression=cron_expression, timezone=timezone)
