import logging
import time
import uuid
from collections.abc import Mapping, Sequence

from flask import Request, Response
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from core.plugin.entities.plugin_daemon import CredentialType
from core.plugin.entities.request import TriggerDispatchResponse
from core.plugin.utils.http_parser import deserialize_request, serialize_request
from core.trigger.entities.entities import EventEntity
from core.trigger.provider import PluginTriggerProviderController
from core.trigger.trigger_manager import TriggerManager
from core.trigger.utils.encryption import create_trigger_provider_encrypter_for_subscription
from core.workflow.enums import NodeType
from core.workflow.nodes.trigger_schedule.exc import TenantOwnerNotFoundError
from extensions.ext_database import db
from extensions.ext_storage import storage
from models.account import Account, TenantAccountJoin, TenantAccountRole
from models.enums import WorkflowRunTriggeredFrom
from models.provider_ids import TriggerProviderID
from models.trigger import TriggerSubscription
from models.workflow import Workflow, WorkflowPluginTrigger
from services.async_workflow_service import AsyncWorkflowService
from services.trigger.trigger_provider_service import TriggerProviderService
from services.workflow.entities import PluginTriggerData, PluginTriggerDispatchData

logger = logging.getLogger(__name__)


class TriggerService:
    __TEMPORARY_ENDPOINT_EXPIRE_MS__ = 5 * 60 * 1000
    __ENDPOINT_REQUEST_CACHE_COUNT__ = 10
    __ENDPOINT_REQUEST_CACHE_EXPIRE_MS__ = 5 * 60 * 1000

    __WEBHOOK_NODE_CACHE_KEY__ = "webhook_nodes"

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
                invoke_response = TriggerManager.invoke_trigger_event(
                    tenant_id=subscription.tenant_id,
                    user_id=subscription.user_id,
                    provider_id=TriggerProviderID(subscription.provider_id),
                    event_name=event.identity.name,
                    parameters=event_node.get("config", {}),
                    credentials=subscription.credentials,
                    credential_type=CredentialType.of(subscription.credential_type),
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
                select(WorkflowPluginTrigger).where(
                    WorkflowPluginTrigger.tenant_id == tenant_id,
                    WorkflowPluginTrigger.subscription_id == subscription_id,
                    WorkflowPluginTrigger.event_name == event_name,
                )
            ).all()
            return list(subscribers)
