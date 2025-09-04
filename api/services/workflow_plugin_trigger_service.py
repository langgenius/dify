from typing import Optional

from sqlalchemy import select
from sqlalchemy.orm import Session
from werkzeug.exceptions import BadRequest, NotFound

from extensions.ext_database import db
from models.workflow import WorkflowPluginTrigger


class WorkflowPluginTriggerService:
    """Service for managing workflow plugin triggers"""

    @classmethod
    def create_plugin_trigger(
        cls,
        app_id: str,
        tenant_id: str,
        node_id: str,
        provider_id: str,
        trigger_name: str,
        subscription_id: str,
    ) -> WorkflowPluginTrigger:
        """Create a new plugin trigger

        Args:
            app_id: The app ID
            tenant_id: The tenant ID
            node_id: The node ID in the workflow
            provider_id: The plugin provider ID
            trigger_name: The trigger name
            subscription_id: The subscription ID

        Returns:
            The created WorkflowPluginTrigger instance

        Raises:
            BadRequest: If plugin trigger already exists for this app and node
        """
        # Create trigger_id from provider_id and trigger_name
        trigger_id = f"{provider_id}:{trigger_name}"

        with Session(db.engine) as session:
            # Check if plugin trigger already exists for this app and node
            # Based on unique constraint: uniq_app_node
            existing_trigger = session.scalar(
                select(WorkflowPluginTrigger).where(
                    WorkflowPluginTrigger.app_id == app_id,
                    WorkflowPluginTrigger.node_id == node_id,
                )
            )

            if existing_trigger:
                raise BadRequest("Plugin trigger already exists for this app and node")

            # Create new plugin trigger
            plugin_trigger = WorkflowPluginTrigger(
                app_id=app_id,
                node_id=node_id,
                tenant_id=tenant_id,
                provider_id=provider_id,
                trigger_id=trigger_id,
                subscription_id=subscription_id,
            )

            session.add(plugin_trigger)
            session.commit()
            session.refresh(plugin_trigger)

        return plugin_trigger

    @classmethod
    def get_plugin_trigger(
        cls,
        app_id: str,
        node_id: str,
    ) -> WorkflowPluginTrigger:
        """Get a plugin trigger by app_id and node_id

        Args:
            app_id: The app ID
            node_id: The node ID in the workflow

        Returns:
            The WorkflowPluginTrigger instance

        Raises:
            NotFound: If plugin trigger not found
        """
        with Session(db.engine) as session:
            # Find plugin trigger using unique constraint
            plugin_trigger = session.scalar(
                select(WorkflowPluginTrigger).where(
                    WorkflowPluginTrigger.app_id == app_id,
                    WorkflowPluginTrigger.node_id == node_id,
                )
            )

            if not plugin_trigger:
                raise NotFound("Plugin trigger not found")

            return plugin_trigger

    @classmethod
    def get_plugin_trigger_by_subscription(
        cls,
        tenant_id: str,
        subscription_id: str,
    ) -> WorkflowPluginTrigger:
        """Get a plugin trigger by tenant_id and subscription_id
        This is the primary query pattern, optimized with composite index

        Args:
            tenant_id: The tenant ID
            subscription_id: The subscription ID

        Returns:
            The WorkflowPluginTrigger instance

        Raises:
            NotFound: If plugin trigger not found
        """
        with Session(db.engine) as session:
            # Find plugin trigger using indexed columns
            plugin_trigger = session.scalar(
                select(WorkflowPluginTrigger).where(
                    WorkflowPluginTrigger.tenant_id == tenant_id,
                    WorkflowPluginTrigger.subscription_id == subscription_id,
                )
            )

            if not plugin_trigger:
                raise NotFound("Plugin trigger not found")

            return plugin_trigger

    @classmethod
    def list_plugin_triggers_by_tenant(
        cls,
        tenant_id: str,
    ) -> list[WorkflowPluginTrigger]:
        """List all plugin triggers for a tenant

        Args:
            tenant_id: The tenant ID

        Returns:
            List of WorkflowPluginTrigger instances
        """
        with Session(db.engine) as session:
            plugin_triggers = session.scalars(
                select(WorkflowPluginTrigger)
                .where(WorkflowPluginTrigger.tenant_id == tenant_id)
                .order_by(WorkflowPluginTrigger.created_at.desc())
            ).all()

            return list(plugin_triggers)

    @classmethod
    def list_plugin_triggers_by_subscription(
        cls,
        subscription_id: str,
    ) -> list[WorkflowPluginTrigger]:
        """List all plugin triggers for a subscription

        Args:
            subscription_id: The subscription ID

        Returns:
            List of WorkflowPluginTrigger instances
        """
        with Session(db.engine) as session:
            plugin_triggers = session.scalars(
                select(WorkflowPluginTrigger)
                .where(WorkflowPluginTrigger.subscription_id == subscription_id)
                .order_by(WorkflowPluginTrigger.created_at.desc())
            ).all()

            return list(plugin_triggers)

    @classmethod
    def update_plugin_trigger(
        cls,
        app_id: str,
        node_id: str,
        provider_id: Optional[str] = None,
        trigger_name: Optional[str] = None,
        subscription_id: Optional[str] = None,
    ) -> WorkflowPluginTrigger:
        """Update a plugin trigger

        Args:
            app_id: The app ID
            node_id: The node ID in the workflow
            provider_id: The new provider ID (optional)
            trigger_name: The new trigger name (optional)
            subscription_id: The new subscription ID (optional)

        Returns:
            The updated WorkflowPluginTrigger instance

        Raises:
            NotFound: If plugin trigger not found
        """
        with Session(db.engine) as session:
            # Find plugin trigger using unique constraint
            plugin_trigger = session.scalar(
                select(WorkflowPluginTrigger).where(
                    WorkflowPluginTrigger.app_id == app_id,
                    WorkflowPluginTrigger.node_id == node_id,
                )
            )

            if not plugin_trigger:
                raise NotFound("Plugin trigger not found")

            # Update fields if provided
            if provider_id:
                plugin_trigger.provider_id = provider_id

            if trigger_name:
                # Update trigger_id if provider_id or trigger_name changed
                provider_id = provider_id or plugin_trigger.provider_id
                plugin_trigger.trigger_id = f"{provider_id}:{trigger_name}"

            if subscription_id:
                plugin_trigger.subscription_id = subscription_id

            session.commit()
            session.refresh(plugin_trigger)

            return plugin_trigger

    @classmethod
    def update_plugin_trigger_by_subscription(
        cls,
        tenant_id: str,
        subscription_id: str,
        provider_id: Optional[str] = None,
        trigger_name: Optional[str] = None,
        new_subscription_id: Optional[str] = None,
    ) -> WorkflowPluginTrigger:
        """Update a plugin trigger by tenant_id and subscription_id

        Args:
            tenant_id: The tenant ID
            subscription_id: The current subscription ID
            provider_id: The new provider ID (optional)
            trigger_name: The new trigger name (optional)
            new_subscription_id: The new subscription ID (optional)

        Returns:
            The updated WorkflowPluginTrigger instance

        Raises:
            NotFound: If plugin trigger not found
        """
        with Session(db.engine) as session:
            # Find plugin trigger using indexed columns
            plugin_trigger = session.scalar(
                select(WorkflowPluginTrigger).where(
                    WorkflowPluginTrigger.tenant_id == tenant_id,
                    WorkflowPluginTrigger.subscription_id == subscription_id,
                )
            )

            if not plugin_trigger:
                raise NotFound("Plugin trigger not found")

            # Update fields if provided
            if provider_id:
                plugin_trigger.provider_id = provider_id

            if trigger_name:
                # Update trigger_id if provider_id or trigger_name changed
                provider_id = provider_id or plugin_trigger.provider_id
                plugin_trigger.trigger_id = f"{provider_id}:{trigger_name}"

            if new_subscription_id:
                plugin_trigger.subscription_id = new_subscription_id

            session.commit()
            session.refresh(plugin_trigger)

            return plugin_trigger

    @classmethod
    def delete_plugin_trigger(
        cls,
        app_id: str,
        node_id: str,
    ) -> None:
        """Delete a plugin trigger by app_id and node_id

        Args:
            app_id: The app ID
            node_id: The node ID in the workflow

        Raises:
            NotFound: If plugin trigger not found
        """
        with Session(db.engine) as session:
            # Find plugin trigger using unique constraint
            plugin_trigger = session.scalar(
                select(WorkflowPluginTrigger).where(
                    WorkflowPluginTrigger.app_id == app_id,
                    WorkflowPluginTrigger.node_id == node_id,
                )
            )

            if not plugin_trigger:
                raise NotFound("Plugin trigger not found")

            session.delete(plugin_trigger)
            session.commit()

    @classmethod
    def delete_plugin_trigger_by_subscription(
        cls,
        tenant_id: str,
        subscription_id: str,
    ) -> None:
        """Delete a plugin trigger by tenant_id and subscription_id

        Args:
            tenant_id: The tenant ID
            subscription_id: The subscription ID

        Raises:
            NotFound: If plugin trigger not found
        """
        with Session(db.engine) as session:
            # Find plugin trigger using indexed columns
            plugin_trigger = session.scalar(
                select(WorkflowPluginTrigger).where(
                    WorkflowPluginTrigger.tenant_id == tenant_id,
                    WorkflowPluginTrigger.subscription_id == subscription_id,
                )
            )

            if not plugin_trigger:
                raise NotFound("Plugin trigger not found")

            session.delete(plugin_trigger)
            session.commit()

    @classmethod
    def delete_all_by_subscription(
        cls,
        subscription_id: str,
    ) -> int:
        """Delete all plugin triggers for a subscription
        Useful when a subscription is cancelled

        Args:
            subscription_id: The subscription ID

        Returns:
            Number of triggers deleted
        """
        with Session(db.engine) as session:
            # Find all plugin triggers for this subscription
            plugin_triggers = session.scalars(
                select(WorkflowPluginTrigger).where(
                    WorkflowPluginTrigger.subscription_id == subscription_id,
                )
            ).all()

            count = len(plugin_triggers)

            for trigger in plugin_triggers:
                session.delete(trigger)

            session.commit()

            return count
