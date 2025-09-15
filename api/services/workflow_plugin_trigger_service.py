from typing import Optional

from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.orm import Session
from werkzeug.exceptions import NotFound

from core.workflow.nodes.enums import NodeType
from extensions.ext_database import db
from extensions.ext_redis import redis_client
from models.model import App
from models.trigger import TriggerSubscription
from models.workflow import Workflow, WorkflowPluginTrigger


class WorkflowPluginTriggerService:
    """Service for managing workflow plugin triggers"""

    __PLUGIN_TRIGGER_NODE_CACHE_KEY__ = "plugin_trigger_nodes"
    MAX_PLUGIN_TRIGGER_NODES_PER_WORKFLOW = 5  # Maximum allowed plugin trigger nodes per workflow

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
                raise ValueError("Plugin trigger already exists for this app and node")

            # Check if subscription exists
            subscription = session.scalar(
                select(TriggerSubscription).where(
                    TriggerSubscription.id == subscription_id,
                )
            )

            if not subscription:
                raise NotFound("Subscription not found")

            # Create new plugin trigger
            plugin_trigger = WorkflowPluginTrigger(
                app_id=app_id,
                node_id=node_id,
                tenant_id=tenant_id,
                provider_id=provider_id,
                trigger_name=trigger_name,
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
        subscription_id: str,
    ) -> WorkflowPluginTrigger:
        """Update a plugin trigger

        Args:
            app_id: The app ID
            node_id: The node ID in the workflow
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

            # Check if subscription exists
            subscription = session.scalar(
                select(TriggerSubscription).where(
                    TriggerSubscription.id == subscription_id,
                )
            )

            if not subscription:
                raise NotFound("Subscription not found")

            # Update subscription ID
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
                plugin_trigger.trigger_name = f"{provider_id}:{trigger_name}"

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

    @classmethod
    def sync_plugin_trigger_relationships(cls, app: App, workflow: Workflow):
        """
        Sync plugin trigger relationships in DB.

        1. Check if the workflow has any plugin trigger nodes
        2. Fetch the nodes from DB, see if there were any plugin trigger records already
        3. Diff the nodes and the plugin trigger records, create/update/delete the records as needed

        Approach:
        Frequent DB operations may cause performance issues, using Redis to cache it instead.
        If any record exists, cache it.

        Limits:
        - Maximum 5 plugin trigger nodes per workflow
        """

        class Cache(BaseModel):
            """
            Cache model for plugin trigger nodes
            """

            record_id: str
            node_id: str
            provider_id: str
            trigger_name: str
            subscription_id: str

        # Walk nodes to find plugin triggers
        nodes_in_graph = []
        for node_id, node_config in workflow.walk_nodes(NodeType.TRIGGER_PLUGIN):
            # Extract plugin trigger configuration from node
            plugin_id = node_config.get("plugin_id", "")
            provider_id = node_config.get("provider_id", "")
            trigger_name = node_config.get("trigger_name", "")
            subscription_id = node_config.get("subscription_id", "")

            if not subscription_id:
                continue

            nodes_in_graph.append(
                {
                    "node_id": node_id,
                    "plugin_id": plugin_id,
                    "provider_id": provider_id,
                    "trigger_name": trigger_name,
                    "subscription_id": subscription_id,
                }
            )

        # Check plugin trigger node limit
        if len(nodes_in_graph) > cls.MAX_PLUGIN_TRIGGER_NODES_PER_WORKFLOW:
            raise ValueError(
                f"Workflow exceeds maximum plugin trigger node limit. "
                f"Found {len(nodes_in_graph)} plugin trigger nodes, "
                f"maximum allowed is {cls.MAX_PLUGIN_TRIGGER_NODES_PER_WORKFLOW}"
            )

        not_found_in_cache: list[dict] = []
        for node_info in nodes_in_graph:
            node_id = node_info["node_id"]
            # firstly check if the node exists in cache
            if not redis_client.get(f"{cls.__PLUGIN_TRIGGER_NODE_CACHE_KEY__}:{node_id}"):
                not_found_in_cache.append(node_info)
                continue

        with Session(db.engine) as session:
            try:
                # lock the concurrent plugin trigger creation
                redis_client.lock(f"{cls.__PLUGIN_TRIGGER_NODE_CACHE_KEY__}:apps:{app.id}:lock", timeout=10)
                # fetch the non-cached nodes from DB
                all_records = session.scalars(
                    select(WorkflowPluginTrigger).where(
                        WorkflowPluginTrigger.app_id == app.id,
                        WorkflowPluginTrigger.tenant_id == app.tenant_id,
                    )
                ).all()

                nodes_id_in_db = {node.node_id: node for node in all_records}
                nodes_id_in_graph = {node["node_id"] for node in nodes_in_graph}

                # get the nodes not found both in cache and DB
                nodes_not_found = [
                    node_info for node_info in not_found_in_cache if node_info["node_id"] not in nodes_id_in_db
                ]

                # create new plugin trigger records
                for node_info in nodes_not_found:
                    plugin_trigger = WorkflowPluginTrigger(
                        app_id=app.id,
                        tenant_id=app.tenant_id,
                        node_id=node_info["node_id"],
                        provider_id=node_info["provider_id"],
                        trigger_name=node_info["trigger_name"],
                        subscription_id=node_info["subscription_id"],
                    )
                    session.add(plugin_trigger)
                    session.flush()  # Get the ID for caching

                    cache = Cache(
                        record_id=plugin_trigger.id,
                        node_id=node_info["node_id"],
                        provider_id=node_info["provider_id"],
                        trigger_name=node_info["trigger_name"],
                        subscription_id=node_info["subscription_id"],
                    )
                    redis_client.set(
                        f"{cls.__PLUGIN_TRIGGER_NODE_CACHE_KEY__}:{node_info['node_id']}",
                        cache.model_dump_json(),
                        ex=60 * 60,
                    )
                session.commit()

                # Update existing records if subscription_id changed
                for node_info in nodes_in_graph:
                    node_id = node_info["node_id"]
                    if node_id in nodes_id_in_db:
                        existing_record = nodes_id_in_db[node_id]
                        if (
                            existing_record.subscription_id != node_info["subscription_id"]
                            or existing_record.provider_id != node_info["provider_id"]
                            or existing_record.trigger_name != node_info["trigger_name"]
                        ):
                            existing_record.subscription_id = node_info["subscription_id"]
                            existing_record.provider_id = node_info["provider_id"]
                            existing_record.trigger_name = node_info["trigger_name"]
                            session.add(existing_record)

                            # Update cache
                            cache = Cache(
                                record_id=existing_record.id,
                                node_id=node_id,
                                provider_id=node_info["provider_id"],
                                trigger_name=node_info["trigger_name"],
                                subscription_id=node_info["subscription_id"],
                            )
                            redis_client.set(
                                f"{cls.__PLUGIN_TRIGGER_NODE_CACHE_KEY__}:{node_id}",
                                cache.model_dump_json(),
                                ex=60 * 60,
                            )
                session.commit()

                # delete the nodes not found in the graph
                for node_id in nodes_id_in_db:
                    if node_id not in nodes_id_in_graph:
                        session.delete(nodes_id_in_db[node_id])
                        redis_client.delete(f"{cls.__PLUGIN_TRIGGER_NODE_CACHE_KEY__}:{node_id}")
                session.commit()
            except Exception:
                import logging

                logger = logging.getLogger(__name__)
                logger.exception("Failed to sync plugin trigger relationships for app %s", app.id)
                raise
            finally:
                redis_client.delete(f"{cls.__PLUGIN_TRIGGER_NODE_CACHE_KEY__}:apps:{app.id}:lock")
