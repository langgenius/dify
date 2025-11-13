import logging
import secrets
import time
from collections.abc import Mapping
from typing import Any

from flask import Request, Response
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.orm import Session

from core.plugin.entities.plugin_daemon import CredentialType
from core.plugin.entities.request import TriggerDispatchResponse, TriggerInvokeEventResponse
from core.plugin.impl.exc import PluginNotFoundError
from core.trigger.debug.events import PluginTriggerDebugEvent
from core.trigger.provider import PluginTriggerProviderController
from core.trigger.trigger_manager import TriggerManager
from core.trigger.utils.encryption import create_trigger_provider_encrypter_for_subscription
from core.workflow.enums import NodeType
from core.workflow.nodes.trigger_plugin.entities import TriggerEventNodeData
from extensions.ext_database import db
from extensions.ext_redis import redis_client
from models.model import App
from models.provider_ids import TriggerProviderID
from models.trigger import TriggerSubscription, WorkflowPluginTrigger
from models.workflow import Workflow
from services.trigger.trigger_provider_service import TriggerProviderService
from services.trigger.trigger_request_service import TriggerHttpRequestCachingService
from services.workflow.entities import PluginTriggerDispatchData
from tasks.trigger_processing_tasks import dispatch_triggered_workflows_async

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
        node_data: TriggerEventNodeData = TriggerEventNodeData.model_validate(node_config.get("data", {}))
        request = TriggerHttpRequestCachingService.get_request(event.request_id)
        payload = TriggerHttpRequestCachingService.get_payload(event.request_id)
        # invoke triger
        provider_controller: PluginTriggerProviderController = TriggerManager.get_trigger_provider(
            tenant_id, TriggerProviderID(subscription.provider_id)
        )
        return TriggerManager.invoke_trigger_event(
            tenant_id=tenant_id,
            user_id=user_id,
            provider_id=TriggerProviderID(event.provider_id),
            event_name=event.name,
            parameters=node_data.resolve_parameters(
                parameter_schemas=provider_controller.get_event_parameters(event_name=event.name)
            ),
            credentials=subscription.credentials,
            credential_type=CredentialType.of(subscription.credential_type),
            subscription=subscription.to_entity(),
            request=request,
            payload=payload,
        )

    @classmethod
    def process_endpoint(cls, endpoint_id: str, request: Request) -> Response | None:
        """
        Extract and process data from incoming endpoint request.

        Args:
            endpoint_id: Endpoint ID
            request: Request
        """
        timestamp = int(time.time())
        subscription: TriggerSubscription | None = None
        try:
            subscription = TriggerProviderService.get_subscription_by_endpoint(endpoint_id)
        except PluginNotFoundError:
            return Response(status=404, response="Trigger provider not found")
        except Exception:
            return Response(status=500, response="Failed to get subscription by endpoint")

        if not subscription:
            return None

        provider_id = TriggerProviderID(subscription.provider_id)
        controller: PluginTriggerProviderController = TriggerManager.get_trigger_provider(
            tenant_id=subscription.tenant_id, provider_id=provider_id
        )
        encrypter, _ = create_trigger_provider_encrypter_for_subscription(
            tenant_id=subscription.tenant_id,
            controller=controller,
            subscription=subscription,
        )
        dispatch_response: TriggerDispatchResponse = controller.dispatch(
            request=request,
            subscription=subscription.to_entity(),
            credentials=encrypter.decrypt(subscription.credentials),
            credential_type=CredentialType.of(subscription.credential_type),
        )

        if dispatch_response.events:
            request_id = f"trigger_request_{timestamp}_{secrets.token_hex(6)}"

            # save the request and payload to storage as persistent data
            TriggerHttpRequestCachingService.persist_request(request_id, request)
            TriggerHttpRequestCachingService.persist_payload(request_id, dispatch_response.payload)

            # Validate event names
            for event_name in dispatch_response.events:
                if controller.get_event(event_name) is None:
                    logger.error(
                        "Event name %s not found in provider %s for endpoint %s",
                        event_name,
                        subscription.provider_id,
                        endpoint_id,
                    )
                    raise ValueError(f"Event name {event_name} not found in provider {subscription.provider_id}")

            plugin_trigger_dispatch_data = PluginTriggerDispatchData(
                user_id=dispatch_response.user_id,
                tenant_id=subscription.tenant_id,
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
        nodes_in_graph: list[Mapping[str, Any]] = []
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

        not_found_in_cache: list[Mapping[str, Any]] = []
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
