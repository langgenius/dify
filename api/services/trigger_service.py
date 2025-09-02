import json
import logging
import uuid

from flask import Request, Response
from sqlalchemy import select
from sqlalchemy.orm import Session

from core.plugin.entities.plugin import TriggerProviderID
from core.trigger.entities.entities import TriggerEntity
from core.trigger.trigger_manager import TriggerManager
from extensions.ext_database import db
from extensions.ext_redis import redis_client
from models.account import Account, TenantAccountJoin, TenantAccountRole
from models.enums import WorkflowRunTriggeredFrom
from models.trigger import TriggerSubscription
from models.workflow import Workflow, WorkflowPluginTrigger
from services.async_workflow_service import AsyncWorkflowService
from services.trigger.trigger_provider_service import TriggerProviderService
from services.workflow.entities import PluginTriggerData

logger = logging.getLogger(__name__)


class TriggerService:
    __TEMPORARY_ENDPOINT_EXPIRE_MS__ = 5 * 60 * 1000
    __ENDPOINT_REQUEST_CACHE_COUNT__ = 10
    __ENDPOINT_REQUEST_CACHE_EXPIRE_MS__ = 5 * 60 * 1000

    @classmethod
    def process_triggered_workflows(
        cls, subscription: TriggerSubscription, trigger: TriggerEntity, request: Request
    ) -> None:
        """Process triggered workflows."""
        # 1. Find associated WorkflowPluginTriggers
        trigger_id = f"{subscription.provider_id}:{trigger.identity.name}"
        plugin_triggers = cls._get_plugin_triggers(trigger_id)

        if not plugin_triggers:
            logger.warning(
                "No workflows found for trigger '%s' in subscription '%s'",
                trigger.identity.name,
                subscription.id,
            )
            return

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
                return

            for plugin_trigger in plugin_triggers:
                # 2. Get workflow
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

                # Get trigger parameters from node configuration
                node_config = workflow.get_node_config_by_id(plugin_trigger.node_id)
                parameters = node_config.get("data", {}).get("parameters", {}) if node_config else {}

                # 3. Store trigger data
                storage_key = cls._store_trigger_data(request, subscription, trigger, parameters)

                # 4. Create trigger data for async execution
                trigger_data = PluginTriggerData(
                    app_id=plugin_trigger.app_id,
                    tenant_id=subscription.tenant_id,
                    workflow_id=workflow.id,
                    root_node_id=plugin_trigger.node_id,
                    trigger_type=WorkflowRunTriggeredFrom.PLUGIN,
                    plugin_id=subscription.provider_id,
                    webhook_url=f"trigger/endpoint/{subscription.endpoint_id}",  # For tracking
                    inputs={"storage_key": storage_key},  # Pass storage key to async task
                )

                # 5. Trigger async workflow
                try:
                    AsyncWorkflowService.trigger_workflow_async(session, tenant_owner, trigger_data)
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

    @classmethod
    def select_triggers(cls, controller, dispatch_response, provider_id, subscription) -> list[TriggerEntity]:
        triggers = []
        for trigger_name in dispatch_response.triggers:
            trigger = controller.get_trigger(trigger_name)
            if trigger is None:
                logger.error(
                    "Trigger '%s' not found in provider '%s' for tenant '%s'",
                    trigger_name,
                    provider_id,
                    subscription.tenant_id,
                )
                raise ValueError(f"Trigger '{trigger_name}' not found")
            triggers.append(trigger)
        return triggers

    @classmethod
    def process_endpoint(cls, endpoint_id: str, request: Request) -> Response | None:
        """Extract and process data from incoming endpoint request."""
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

        # TODO invoke triggers
        if dispatch_response.triggers:
            triggers = cls.select_triggers(controller, dispatch_response, provider_id, subscription)
            for trigger in triggers:
                cls.process_triggered_workflows(
                    subscription=subscription,
                    trigger=trigger,
                    request=request,
                )
        return dispatch_response.response

    @classmethod
    def _get_plugin_triggers(cls, trigger_id: str) -> list[WorkflowPluginTrigger]:
        """Get WorkflowPluginTriggers for a trigger_id."""
        with Session(db.engine) as session:
            triggers = session.scalars(
                select(WorkflowPluginTrigger).where(
                    WorkflowPluginTrigger.trigger_id == trigger_id,
                    WorkflowPluginTrigger.triggered_by == "production",  # Only production triggers for now
                )
            ).all()
            return list(triggers)

    @classmethod
    def _store_trigger_data(
        cls,
        request: Request,
        subscription: TriggerSubscription,
        trigger: TriggerEntity,
        parameters: dict,
    ) -> str:
        """Store trigger data in storage and return key."""
        storage_key = f"trigger_data_{uuid.uuid4().hex}"

        # Prepare data to store
        trigger_data = {
            "request": {
                "method": request.method,
                "headers": dict(request.headers),
                "query_params": dict(request.args),
                "body": request.get_data(as_text=True),
            },
            "subscription": {
                "id": subscription.id,
                "provider_id": subscription.provider_id,
                "credentials": subscription.credentials,
                "credential_type": subscription.credential_type,
            },
            "trigger": {
                "name": trigger.identity.name,
                "parameters": parameters,
            },
            "user_id": subscription.user_id,
        }

        # Store with 1 hour TTL using Redis
        redis_client.setex(storage_key, 3600, json.dumps(trigger_data))

        return storage_key
