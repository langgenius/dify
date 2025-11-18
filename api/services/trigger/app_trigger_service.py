"""
AppTrigger management service.

Handles AppTrigger model CRUD operations and status management.
This service centralizes all AppTrigger-related business logic.
"""

import logging

from sqlalchemy import update
from sqlalchemy.orm import Session

from extensions.ext_database import db
from models.enums import AppTriggerStatus
from models.trigger import AppTrigger

logger = logging.getLogger(__name__)


class AppTriggerService:
    """Service for managing AppTrigger lifecycle and status."""

    @staticmethod
    def mark_tenant_triggers_rate_limited(tenant_id: str) -> None:
        """
        Mark all enabled triggers for a tenant as rate limited due to quota exceeded.

        This method is called when a tenant's quota is exhausted. It updates all
        enabled triggers to RATE_LIMITED status to prevent further executions until
        quota is restored.

        Args:
            tenant_id: Tenant ID whose triggers should be marked as rate limited

        """
        try:
            with Session(db.engine) as session:
                session.execute(
                    update(AppTrigger)
                    .where(AppTrigger.tenant_id == tenant_id, AppTrigger.status == AppTriggerStatus.ENABLED)
                    .values(status=AppTriggerStatus.RATE_LIMITED)
                )
                session.commit()
                logger.info("Marked all enabled triggers as rate limited for tenant %s", tenant_id)
        except Exception:
            logger.exception("Failed to mark all enabled triggers as rate limited for tenant %s", tenant_id)
