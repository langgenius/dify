import logging
from typing import Any

from flask_restx import Resource, marshal_with, reqparse
from sqlalchemy import select
from sqlalchemy.orm import Session
from werkzeug.exceptions import Forbidden, NotFound

from controllers.console import api
from controllers.console.app.wraps import get_app_model
from controllers.console.wraps import account_initialization_required, setup_required
from core.trigger.trigger_manager import TriggerManager
from extensions.ext_database import db
from fields.workflow_trigger_fields import trigger_fields, triggers_list_fields, webhook_trigger_fields
from libs.login import current_user, login_required
from models.enums import AppTriggerStatus, AppTriggerType
from models.model import Account, App, AppMode
from models.provider_ids import TriggerProviderID
from models.trigger import AppTrigger, WorkflowPluginTrigger, WorkflowWebhookTrigger

logger = logging.getLogger(__name__)


class WebhookTriggerApi(Resource):
    """Webhook Trigger API"""

    @setup_required
    @login_required
    @account_initialization_required
    @get_app_model(mode=AppMode.WORKFLOW)
    @marshal_with(webhook_trigger_fields)
    def get(self, app_model: App):
        """Get webhook trigger for a node"""
        parser = reqparse.RequestParser()
        parser.add_argument("node_id", type=str, required=True, help="Node ID is required")
        args = parser.parse_args()

        node_id = str(args["node_id"])

        with Session(db.engine) as session:
            # Get webhook trigger for this app and node
            webhook_trigger = (
                session.query(WorkflowWebhookTrigger)
                .where(
                    WorkflowWebhookTrigger.app_id == app_model.id,
                    WorkflowWebhookTrigger.node_id == node_id,
                )
                .first()
            )

            if not webhook_trigger:
                raise NotFound("Webhook trigger not found for this node")

            return webhook_trigger


class AppTriggersApi(Resource):
    """App Triggers list API"""

    @setup_required
    @login_required
    @account_initialization_required
    @get_app_model(mode=AppMode.WORKFLOW)
    @marshal_with(triggers_list_fields)
    def get(self, app_model: App):
        """Get app triggers list"""
        assert isinstance(current_user, Account)
        assert current_user.current_tenant_id is not None

        with Session(db.engine) as session:
            # Get all triggers for this app using select API
            triggers = (
                session.execute(
                    select(AppTrigger)
                    .where(
                        AppTrigger.tenant_id == current_user.current_tenant_id,
                        AppTrigger.app_id == app_model.id,
                    )
                    .order_by(AppTrigger.created_at.desc(), AppTrigger.id.desc())
                )
                .scalars()
                .all()
            )

            plugin_node_ids = [
                trigger.node_id for trigger in triggers if trigger.trigger_type == AppTriggerType.TRIGGER_PLUGIN.value
            ]
            plugin_trigger_map: dict[str, WorkflowPluginTrigger] = {}
            if plugin_node_ids:
                plugin_triggers = (
                    session.execute(
                        select(WorkflowPluginTrigger).where(
                            WorkflowPluginTrigger.app_id == app_model.id,
                            WorkflowPluginTrigger.node_id.in_(plugin_node_ids),
                        )
                    )
                    .scalars()
                    .all()
                )
                plugin_trigger_map = {plugin_trigger.node_id: plugin_trigger for plugin_trigger in plugin_triggers}

        tenant_id = current_user.current_tenant_id if isinstance(current_user, Account) else None
        provider_cache: dict[str, dict[str, Any]] = {}

        def resolve_provider_metadata(provider_id: str) -> dict[str, Any]:
            if provider_id in provider_cache:
                return provider_cache[provider_id]
            metadata: dict[str, Any] = {}
            if not tenant_id:
                provider_cache[provider_id] = metadata
                return metadata
            try:
                controller = TriggerManager.get_trigger_provider(tenant_id, TriggerProviderID(provider_id))
                api_entity = controller.to_api_entity()
                metadata = {
                    "plugin_id": controller.plugin_id,
                    "plugin_unique_identifier": controller.plugin_unique_identifier,
                    "icon": api_entity.icon or "",
                    "provider_name": api_entity.name,
                    "provider_label": api_entity.label,
                }
            except Exception:
                metadata = {}
            provider_cache[provider_id] = metadata
            return metadata

        for trigger in triggers:
            if trigger.trigger_type == AppTriggerType.TRIGGER_PLUGIN.value:
                plugin_trigger = plugin_trigger_map.get(trigger.node_id)
                if not plugin_trigger:
                    trigger.icon = ""  # type: ignore[attr-defined]
                    continue
                trigger.provider_id = plugin_trigger.provider_id  # type: ignore[attr-defined]
                trigger.subscription_id = plugin_trigger.subscription_id  # type: ignore[attr-defined]
                trigger.event_name = plugin_trigger.event_name  # type: ignore[attr-defined]
                metadata = resolve_provider_metadata(plugin_trigger.provider_id)
                trigger.plugin_id = metadata.get("plugin_id")  # type: ignore[attr-defined]
                trigger.plugin_unique_identifier = metadata.get("plugin_unique_identifier")  # type: ignore[attr-defined]
                trigger.icon = metadata.get("icon", "")  # type: ignore[attr-defined]
                if not trigger.provider_name:
                    trigger.provider_name = metadata.get("provider_name", "")
                trigger.provider_label = metadata.get("provider_label")  # type: ignore[attr-defined]
            else:
                trigger.icon = ""  # type: ignore[attr-defined]

        return {"data": triggers}


class AppTriggerEnableApi(Resource):
    @setup_required
    @login_required
    @account_initialization_required
    @get_app_model(mode=AppMode.WORKFLOW)
    @marshal_with(trigger_fields)
    def post(self, app_model: App):
        """Update app trigger (enable/disable)"""
        parser = reqparse.RequestParser()
        parser.add_argument("trigger_id", type=str, required=True, nullable=False, location="json")
        parser.add_argument("enable_trigger", type=bool, required=True, nullable=False, location="json")
        args = parser.parse_args()

        assert isinstance(current_user, Account)
        assert current_user.current_tenant_id is not None
        if not current_user.has_edit_permission:
            raise Forbidden()

        trigger_id = args["trigger_id"]

        with Session(db.engine) as session:
            # Find the trigger using select
            trigger = session.execute(
                select(AppTrigger).where(
                    AppTrigger.id == trigger_id,
                    AppTrigger.tenant_id == current_user.current_tenant_id,
                    AppTrigger.app_id == app_model.id,
                )
            ).scalar_one_or_none()

            if not trigger:
                raise NotFound("Trigger not found")

            # Update status based on enable_trigger boolean
            trigger.status = AppTriggerStatus.ENABLED if args["enable_trigger"] else AppTriggerStatus.DISABLED

            session.commit()
            session.refresh(trigger)

        if trigger.trigger_type == AppTriggerType.TRIGGER_PLUGIN.value:
            plugin_icon = ""
            with Session(db.engine) as session:
                plugin_trigger = session.execute(
                    select(WorkflowPluginTrigger).where(
                        WorkflowPluginTrigger.app_id == app_model.id,
                        WorkflowPluginTrigger.node_id == trigger.node_id,
                    )
                ).scalar_one_or_none()
            if plugin_trigger and current_user.current_tenant_id:
                try:
                    controller = TriggerManager.get_trigger_provider(
                        current_user.current_tenant_id, TriggerProviderID(plugin_trigger.provider_id)
                    )
                    trigger.provider_id = plugin_trigger.provider_id  # type: ignore[attr-defined]
                    trigger.subscription_id = plugin_trigger.subscription_id  # type: ignore[attr-defined]
                    trigger.event_name = plugin_trigger.event_name  # type: ignore[attr-defined]
                    trigger.plugin_id = controller.plugin_id  # type: ignore[attr-defined]
                    trigger.plugin_unique_identifier = controller.plugin_unique_identifier  # type: ignore[attr-defined]
                    trigger.provider_label = controller.to_api_entity().label  # type: ignore[attr-defined]
                    plugin_icon = controller.to_api_entity().icon or ""
                except Exception:
                    plugin_icon = ""
            trigger.icon = plugin_icon  # type: ignore[attr-defined]
        else:
            trigger.icon = ""  # type: ignore[attr-defined]

        return trigger


api.add_resource(WebhookTriggerApi, "/apps/<uuid:app_id>/workflows/triggers/webhook")
api.add_resource(AppTriggersApi, "/apps/<uuid:app_id>/triggers")
api.add_resource(AppTriggerEnableApi, "/apps/<uuid:app_id>/trigger-enable")
