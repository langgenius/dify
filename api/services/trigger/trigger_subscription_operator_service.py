from sqlalchemy import and_, select
from sqlalchemy.orm import Session

from extensions.ext_database import db
from models.enums import AppTriggerStatus
from models.trigger import AppTrigger, WorkflowPluginTrigger


class TriggerSubscriptionOperatorService:
    @classmethod
    def get_subscriber_triggers(
        cls, tenant_id: str, subscription_id: str, event_name: str
    ) -> list[WorkflowPluginTrigger]:
        """
        Get WorkflowPluginTriggers for a subscription and trigger.

        Args:
            tenant_id: Tenant ID
            subscription_id: Subscription ID
            event_name: Event name
        """
        with Session(db.engine, expire_on_commit=False) as session:
            subscribers = session.scalars(
                select(WorkflowPluginTrigger)
                .join(
                    AppTrigger,
                    and_(
                        AppTrigger.tenant_id == WorkflowPluginTrigger.tenant_id,
                        AppTrigger.app_id == WorkflowPluginTrigger.app_id,
                        AppTrigger.node_id == WorkflowPluginTrigger.node_id,
                    ),
                )
                .where(
                    WorkflowPluginTrigger.tenant_id == tenant_id,
                    WorkflowPluginTrigger.subscription_id == subscription_id,
                    WorkflowPluginTrigger.event_name == event_name,
                    AppTrigger.status == AppTriggerStatus.ENABLED,
                )
            ).all()
            return list(subscribers)

    @classmethod
    def delete_plugin_trigger_by_subscription(
        cls,
        session: Session,
        tenant_id: str,
        subscription_id: str,
    ) -> None:
        """Delete a plugin trigger by tenant_id and subscription_id within an existing session

        Args:
            session: Database session
            tenant_id: The tenant ID
            subscription_id: The subscription ID

        Raises:
            NotFound: If plugin trigger not found
        """
        # Find plugin trigger using indexed columns
        plugin_trigger = session.scalar(
            select(WorkflowPluginTrigger).where(
                WorkflowPluginTrigger.tenant_id == tenant_id,
                WorkflowPluginTrigger.subscription_id == subscription_id,
            )
        )

        if not plugin_trigger:
            return

        session.delete(plugin_trigger)
