import logging
import time
import uuid

from flask import Request, Response
from sqlalchemy import select
from sqlalchemy.orm import Session

from core.plugin.entities.plugin import TriggerProviderID
from core.plugin.utils.http_parser import serialize_request
from core.trigger.entities.entities import TriggerDebugEventData, TriggerEntity, TriggerInputs
from core.trigger.trigger_manager import TriggerManager
from extensions.ext_database import db
from extensions.ext_storage import storage
from models.account import Account, TenantAccountJoin, TenantAccountRole
from models.enums import WorkflowRunTriggeredFrom
from models.trigger import TriggerSubscription
from models.workflow import Workflow, WorkflowPluginTrigger
from services.async_workflow_service import AsyncWorkflowService
from services.trigger.trigger_provider_service import TriggerProviderService
from services.trigger_debug_service import TriggerDebugService
from services.workflow.entities import PluginTriggerData

logger = logging.getLogger(__name__)


class TriggerService:
    __TEMPORARY_ENDPOINT_EXPIRE_MS__ = 5 * 60 * 1000
    __ENDPOINT_REQUEST_CACHE_COUNT__ = 10
    __ENDPOINT_REQUEST_CACHE_EXPIRE_MS__ = 5 * 60 * 1000

    __WEBHOOK_NODE_CACHE_KEY__ = "webhook_nodes"

    @classmethod
    def dispatch_triggered_workflows(
        cls, subscription: TriggerSubscription, trigger: TriggerEntity, request_id: str
    ) -> int:
        """Process triggered workflows.

        Args:
            subscription: The trigger subscription
            trigger: The trigger entity that was activated
            request_id: The ID of the stored request in storage system
        """

        subscribers = cls.get_subscriber_triggers(
            tenant_id=subscription.tenant_id, subscription_id=subscription.id, trigger_name=trigger.identity.name
        )
        if not subscribers:
            logger.warning(
                "No workflows found for trigger '%s' in subscription '%s'",
                trigger.identity.name,
                subscription.id,
            )
            return 0

        with Session(db.engine) as session:
            # Get tenant owner for workflow execution
            tenant_owner = session.scalar(
                select(Account)
                .join(TenantAccountJoin, TenantAccountJoin.account_id == Account.id)
                .where(
                    TenantAccountJoin.tenant_id == subscription.tenant_id,
                    TenantAccountJoin.role == TenantAccountRole.OWNER,
                )
            )

            if not tenant_owner:
                logger.error("Tenant owner not found for tenant %s", subscription.tenant_id)
                return 0
            dispatched_count = 0
            for plugin_trigger in subscribers:
                # Get workflow
                workflow = session.scalar(
                    select(Workflow)
                    .where(
                        Workflow.app_id == plugin_trigger.app_id,
                        Workflow.version != Workflow.VERSION_DRAFT,
                    )
                    .order_by(Workflow.created_at.desc())
                )

                if not workflow:
                    logger.error(
                        "Workflow not found for app %s",
                        plugin_trigger.app_id,
                    )
                    continue

                # Create trigger inputs using new structure
                trigger_inputs = TriggerInputs.from_trigger_entity(
                    request_id=request_id, subscription_id=subscription.id, trigger=trigger
                )

                # Create trigger data for async execution
                trigger_data = PluginTriggerData(
                    app_id=plugin_trigger.app_id,
                    tenant_id=subscription.tenant_id,
                    workflow_id=workflow.id,
                    root_node_id=plugin_trigger.node_id,
                    trigger_type=WorkflowRunTriggeredFrom.PLUGIN,
                    plugin_id=subscription.provider_id,
                    endpoint_id=subscription.endpoint_id,
                    inputs=trigger_inputs.to_dict(),
                )

                # Trigger async workflow
                try:
                    AsyncWorkflowService.trigger_workflow_async(session, tenant_owner, trigger_data)
                    dispatched_count += 1
                    logger.info(
                        "Triggered workflow for app %s with trigger %s",
                        plugin_trigger.app_id,
                        trigger.identity.name,
                    )
                except Exception:
                    logger.exception(
                        "Failed to trigger workflow for app %s",
                        plugin_trigger.app_id,
                    )

            return dispatched_count

    @classmethod
    def dispatch_debugging_sessions(cls, subscription_id: str, triggers: list[str], request_id: str) -> int:
        """
        Dispatch to debug sessions - simplified version.

        Args:
            subscription_id: Subscription ID
            triggers: List of trigger names
            request_id: Request ID for storage reference
        """
        try:
            # Prepare streamlined event data using Pydantic model
            debug_data = TriggerDebugEventData(
                subscription_id=subscription_id,
                triggers=triggers,
                request_id=request_id,
                timestamp=time.time(),
            )
            return TriggerDebugService.dispatch_to_debug_sessions(
                subscription_id=subscription_id, event_data=debug_data
            )

        except Exception as e:
            # Silent failure, don't affect production
            logger.exception("Debug dispatch failed", exc_info=e)
            return 0

    @classmethod
    def process_endpoint(cls, endpoint_id: str, request: Request) -> Response | None:
        """
        Extract and process data from incoming endpoint request.

        Args:
            endpoint_id: Endpoint ID
            request: Request
        """
        subscription = TriggerProviderService.get_subscription_by_endpoint(endpoint_id)
        if not subscription:
            return None

        provider_id = TriggerProviderID(subscription.provider_id)
        controller = TriggerManager.get_trigger_provider(subscription.tenant_id, provider_id)
        if not controller:
            return None

        dispatch_response = controller.dispatch(
            user_id=subscription.user_id, request=request, subscription=subscription.to_entity()
        )

        if dispatch_response.triggers:
            request_id = f"trigger_request_{uuid.uuid4().hex}"
            serialized_request = serialize_request(request)
            storage.save(f"triggers/{request_id}", serialized_request)

            from tasks.trigger_processing_tasks import dispatch_triggered_workflows_async

            dispatch_triggered_workflows_async(
                endpoint_id=endpoint_id,
                provider_id=subscription.provider_id,
                subscription_id=subscription.id,
                triggers=list(dispatch_response.triggers),
                request_id=request_id,
            )

            logger.info(
                "Queued async dispatching for %d triggers on endpoint %s with request_id %s",
                len(dispatch_response.triggers),
                endpoint_id,
                request_id,
            )

        return dispatch_response.response

    @classmethod
    def get_subscriber_triggers(
        cls, tenant_id: str, subscription_id: str, trigger_name: str
    ) -> list[WorkflowPluginTrigger]:
        """
        Get WorkflowPluginTriggers for a subscription and trigger.

        Args:
            tenant_id: Tenant ID
            subscription_id: Subscription ID
            trigger_name: Trigger name
        """
        with Session(db.engine, expire_on_commit=False) as session:
            subscribers = session.scalars(
                select(WorkflowPluginTrigger).where(
                    WorkflowPluginTrigger.tenant_id == tenant_id,
                    WorkflowPluginTrigger.subscription_id == subscription_id,
                    WorkflowPluginTrigger.trigger_name == trigger_name,
                )
            ).all()
            return list(subscribers)
