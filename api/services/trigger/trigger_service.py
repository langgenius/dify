import logging
import time
import uuid
from collections.abc import Mapping, Sequence
from typing import Any

from flask import Request, Response
from pydantic import BaseModel
from sqlalchemy import and_, func, select
from sqlalchemy.orm import Session

from core.plugin.entities.plugin_daemon import CredentialType
from core.plugin.entities.request import TriggerDispatchResponse, TriggerInvokeEventResponse
from core.plugin.utils.http_parser import deserialize_request, serialize_request
from core.trigger.debug.events import PluginTriggerDebugEvent
from core.trigger.entities.entities import EventEntity
from core.trigger.provider import PluginTriggerProviderController
from core.trigger.trigger_manager import TriggerManager
from core.trigger.utils.encryption import create_trigger_provider_encrypter_for_subscription
from core.workflow.enums import NodeType
from core.workflow.nodes.trigger_plugin.entities import PluginTriggerNodeData
from core.workflow.nodes.trigger_schedule.exc import TenantOwnerNotFoundError
from extensions.ext_database import db
from extensions.ext_redis import redis_client
from extensions.ext_storage import storage
from models.account import Account, TenantAccountJoin, TenantAccountRole
from models.enums import WorkflowRunTriggeredFrom
from models.model import App
from models.provider_ids import TriggerProviderID
from models.trigger import TriggerSubscription
from models.workflow import AppTrigger, AppTriggerStatus, Workflow, WorkflowPluginTrigger
from services.async_workflow_service import AsyncWorkflowService
from services.trigger.trigger_provider_service import TriggerProviderService
from services.workflow.entities import PluginTriggerData, PluginTriggerDispatchData

logger = logging.getLogger(__name__)


class TriggerService:
    __TEMPORARY_ENDPOINT_EXPIRE_MS__ = 5 * 60 * 1000
    __ENDPOINT_REQUEST_CACHE_COUNT__ = 10
    __ENDPOINT_REQUEST_CACHE_EXPIRE_MS__ = 5 * 60 * 1000
    __PLUGIN_TRIGGER_NODE_CACHE_KEY__ = "plugin_trigger_nodes"
    MAX_PLUGIN_TRIGGER_NODES_PER_WORKFLOW = 5  # Maximum allowed plugin trigger nodes per workflow

    @classmethod
    def invoke_trigger_event(
        cls, tenant_id: str, user_id: str, node_config: Mapping[str, Any], event: PluginTriggerDebugEvent
    ) -> TriggerInvokeEventResponse:
        """Invoke a trigger event."""
        subscription: TriggerSubscription | None = TriggerProviderService.get_subscription_by_id(
            tenant_id=tenant_id,
            subscription_id=event.subscription_id,
        )
        if not subscription:
            raise ValueError("Subscription not found")
        node_data: PluginTriggerNodeData = PluginTriggerNodeData.model_validate(node_config.get("data", {}))
        request = deserialize_request(storage.load_once(f"triggers/{event.request_id}"))
        if not request:
            raise ValueError("Request not found")
        # invoke triger
        return TriggerManager.invoke_trigger_event(
            tenant_id=tenant_id,
            user_id=user_id,
            provider_id=TriggerProviderID(event.provider_id),
            event_name=event.name,
            parameters=node_data.parameters,
            credentials=subscription.credentials,
            credential_type=CredentialType.of(subscription.credential_type),
            subscription=subscription.to_entity(),
            request=request,
        )

    @classmethod
    def _get_latest_workflows_by_app_ids(
        cls, session: Session, subscribers: Sequence[WorkflowPluginTrigger]
    ) -> Mapping[str, Workflow]:
        """Get the latest workflows by app_ids"""
        workflow_query = (
            select(Workflow.app_id, func.max(Workflow.created_at).label("max_created_at"))
            .where(
                Workflow.app_id.in_({t.app_id for t in subscribers}),
                Workflow.version != Workflow.VERSION_DRAFT,
            )
            .group_by(Workflow.app_id)
            .subquery()
        )
        workflows = session.scalars(
            select(Workflow).join(
                workflow_query,
                (Workflow.app_id == workflow_query.c.app_id) & (Workflow.created_at == workflow_query.c.max_created_at),
            )
        ).all()
        return {w.app_id: w for w in workflows}

    @classmethod
    def _get_tenant_owner(cls, session: Session, tenant_id: str) -> Account:
        """Get the tenant owner account for workflow execution."""
        owner = session.scalar(
            select(Account)
            .join(TenantAccountJoin, TenantAccountJoin.account_id == Account.id)
            .where(TenantAccountJoin.tenant_id == tenant_id, TenantAccountJoin.role == TenantAccountRole.OWNER)
        )
        if not owner:
            raise TenantOwnerNotFoundError(f"Tenant owner not found for tenant {tenant_id}")
        return owner

    @classmethod
    def dispatch_triggered_workflows(
        cls, subscription: TriggerSubscription, event: EventEntity, request_id: str
    ) -> int:
        """Process triggered workflows.

        Args:
            subscription: The trigger subscription
            event: The trigger entity that was activated
            request_id: The ID of the stored request in storage system
        """
        request = deserialize_request(storage.load_once(f"triggers/{request_id}"))
        if not request:
            logger.error("Request not found for request_id %s", request_id)
            return 0

        subscribers: list[WorkflowPluginTrigger] = cls.get_subscriber_triggers(
            tenant_id=subscription.tenant_id, subscription_id=subscription.id, event_name=event.identity.name
        )
        if not subscribers:
            logger.warning(
                "No workflows found for trigger event '%s' in subscription '%s'",
                event.identity.name,
                subscription.id,
            )
            return 0

        dispatched_count = 0
        with Session(db.engine) as session:
            tenant_owner = cls._get_tenant_owner(session, subscription.tenant_id)
            workflows = cls._get_latest_workflows_by_app_ids(session, subscribers)
            for plugin_trigger in subscribers:
                # Get workflow from mapping
                workflow = workflows.get(plugin_trigger.app_id)
                if not workflow:
                    logger.error(
                        "Workflow not found for app %s",
                        plugin_trigger.app_id,
                    )
                    continue

                # Find the trigger node in the workflow
                event_node = None
                for node_id, node_config in workflow.walk_nodes(NodeType.TRIGGER_PLUGIN):
                    if node_id == plugin_trigger.node_id:
                        event_node = node_config
                        break

                if not event_node:
                    logger.error("Trigger event node not found for app %s", plugin_trigger.app_id)
                    continue

                # invoke triger
                node_data: PluginTriggerNodeData = PluginTriggerNodeData.model_validate(event_node.get("data", {}))
                invoke_response: TriggerInvokeEventResponse = TriggerManager.invoke_trigger_event(
                    tenant_id=subscription.tenant_id,
                    user_id=subscription.user_id,
                    provider_id=TriggerProviderID(subscription.provider_id),
                    event_name=event.identity.name,
                    parameters=node_data.parameters,
                    credentials=subscription.credentials,
                    credential_type=CredentialType.of(subscription.credential_type),
                    subscription=subscription.to_entity(),
                    request=request,
                )
                if invoke_response.cancelled:
                    logger.info(
                        "Trigger ignored for app %s with trigger event %s",
                        plugin_trigger.app_id,
                        event.identity.name,
                    )
                    continue

                # Create trigger data for async execution
                trigger_data = PluginTriggerData(
                    app_id=plugin_trigger.app_id,
                    tenant_id=subscription.tenant_id,
                    workflow_id=workflow.id,
                    root_node_id=plugin_trigger.node_id,
                    trigger_type=WorkflowRunTriggeredFrom.PLUGIN,
                    plugin_id=subscription.provider_id,
                    endpoint_id=subscription.endpoint_id,
                    inputs=invoke_response.variables,
                )

                # Trigger async workflow
                try:
                    AsyncWorkflowService.trigger_workflow_async(session, tenant_owner, trigger_data)
                    dispatched_count += 1
                    logger.info(
                        "Triggered workflow for app %s with trigger event %s",
                        plugin_trigger.app_id,
                        event.identity.name,
                    )
                except Exception:
                    logger.exception(
                        "Failed to trigger workflow for app %s",
                        plugin_trigger.app_id,
                    )

            return dispatched_count

    @classmethod
    def process_endpoint(cls, endpoint_id: str, request: Request) -> Response | None:
        """
        Extract and process data from incoming endpoint request.

        Args:
            endpoint_id: Endpoint ID
            request: Request
        """
        timestamp = int(time.time())
        subscription: TriggerSubscription | None = TriggerProviderService.get_subscription_by_endpoint(endpoint_id)
        if not subscription:
            return None

        provider_id = TriggerProviderID(subscription.provider_id)
        controller: PluginTriggerProviderController = TriggerManager.get_trigger_provider(
            tenant_id=subscription.tenant_id, provider_id=provider_id
        )
        if not controller:
            return None

        encrypter, _ = create_trigger_provider_encrypter_for_subscription(
            tenant_id=subscription.tenant_id,
            controller=controller,
            subscription=subscription,
        )
        dispatch_response: TriggerDispatchResponse = controller.dispatch(
            user_id=subscription.user_id,
            request=request,
            subscription=subscription.to_entity(),
            credentials=encrypter.decrypt(subscription.credentials),
            credential_type=CredentialType.of(subscription.credential_type),
        )

        if dispatch_response.events:
            request_id = f"trigger_request_{uuid.uuid4().hex}"
            serialized_request = serialize_request(request)
            storage.save(f"triggers/{request_id}", serialized_request)

            # Production dispatch
            from tasks.trigger_processing_tasks import dispatch_triggered_workflows_async

            plugin_trigger_dispatch_data = PluginTriggerDispatchData(
                endpoint_id=endpoint_id,
                provider_id=subscription.provider_id,
                subscription_id=subscription.id,
                timestamp=timestamp,
                events=list(dispatch_response.events),
                request_id=request_id,
            )
            dispatch_data = plugin_trigger_dispatch_data.model_dump(mode="json")
            dispatch_triggered_workflows_async.delay(dispatch_data)

            logger.info(
                "Queued async dispatching for %d triggers on endpoint %s with request_id %s",
                len(dispatch_response.events),
                endpoint_id,
                request_id,
            )
        return dispatch_response.response

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
            event_name: str
            subscription_id: str

        # Walk nodes to find plugin triggers
        nodes_in_graph = []
        for node_id, node_config in workflow.walk_nodes(NodeType.TRIGGER_PLUGIN):
            # Extract plugin trigger configuration from node
            plugin_id = node_config.get("plugin_id", "")
            provider_id = node_config.get("provider_id", "")
            event_name = node_config.get("event_name", "")
            subscription_id = node_config.get("subscription_id", "")

            if not subscription_id:
                continue

            nodes_in_graph.append(
                {
                    "node_id": node_id,
                    "plugin_id": plugin_id,
                    "provider_id": provider_id,
                    "event_name": event_name,
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
                        event_name=node_info["event_name"],
                        subscription_id=node_info["subscription_id"],
                    )
                    session.add(plugin_trigger)
                    session.flush()  # Get the ID for caching

                    cache = Cache(
                        record_id=plugin_trigger.id,
                        node_id=node_info["node_id"],
                        provider_id=node_info["provider_id"],
                        event_name=node_info["event_name"],
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
                            or existing_record.event_name != node_info["event_name"]
                        ):
                            existing_record.subscription_id = node_info["subscription_id"]
                            existing_record.provider_id = node_info["provider_id"]
                            existing_record.event_name = node_info["event_name"]
                            session.add(existing_record)

                            # Update cache
                            cache = Cache(
                                record_id=existing_record.id,
                                node_id=node_id,
                                provider_id=node_info["provider_id"],
                                event_name=node_info["event_name"],
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
