import logging

from flask_restx import Resource, marshal_with, reqparse
from sqlalchemy import select
from sqlalchemy.orm import Session
from werkzeug.exceptions import Forbidden, NotFound

from configs import dify_config
from controllers.console import api
from controllers.console.app.wraps import get_app_model
from controllers.console.wraps import account_initialization_required, setup_required
from core.model_runtime.utils.encoders import jsonable_encoder
from extensions.ext_database import db
from fields.workflow_trigger_fields import trigger_fields, triggers_list_fields, webhook_trigger_fields
from libs.login import current_user, login_required
from models.model import Account, AppMode
from models.workflow import AppTrigger, AppTriggerStatus, WorkflowWebhookTrigger

logger = logging.getLogger(__name__)

from services.workflow_plugin_trigger_service import WorkflowPluginTriggerService


class PluginTriggerApi(Resource):
    """Workflow Plugin Trigger API"""

    @setup_required
    @login_required
    @account_initialization_required
    @get_app_model(mode=AppMode.WORKFLOW)
    def post(self, app_model):
        """Create plugin trigger"""
        parser = reqparse.RequestParser()
        parser.add_argument("node_id", type=str, required=False, location="json")
        parser.add_argument("provider_id", type=str, required=False, location="json")
        parser.add_argument("trigger_name", type=str, required=False, location="json")
        parser.add_argument("subscription_id", type=str, required=False, location="json")
        args = parser.parse_args()

        assert isinstance(current_user, Account)
        assert current_user.current_tenant_id is not None
        if not current_user.is_editor:
            raise Forbidden()

        plugin_trigger = WorkflowPluginTriggerService.create_plugin_trigger(
            app_id=app_model.id,
            tenant_id=current_user.current_tenant_id,
            node_id=args["node_id"],
            provider_id=args["provider_id"],
            trigger_name=args["trigger_name"],
            subscription_id=args["subscription_id"],
        )

        return jsonable_encoder(plugin_trigger)

    @setup_required
    @login_required
    @account_initialization_required
    @get_app_model(mode=AppMode.WORKFLOW)
    def get(self, app_model):
        """Get plugin trigger"""
        parser = reqparse.RequestParser()
        parser.add_argument("node_id", type=str, required=True, help="Node ID is required")
        args = parser.parse_args()

        plugin_trigger = WorkflowPluginTriggerService.get_plugin_trigger(
            app_id=app_model.id,
            node_id=args["node_id"],
        )

        return jsonable_encoder(plugin_trigger)

    @setup_required
    @login_required
    @account_initialization_required
    @get_app_model(mode=AppMode.WORKFLOW)
    def put(self, app_model):
        """Update plugin trigger"""
        parser = reqparse.RequestParser()
        parser.add_argument("node_id", type=str, required=True, help="Node ID is required")
        parser.add_argument("subscription_id", type=str, required=True, location="json", help="Subscription ID")
        args = parser.parse_args()

        assert isinstance(current_user, Account)
        assert current_user.current_tenant_id is not None
        if not current_user.is_editor:
            raise Forbidden()

        plugin_trigger = WorkflowPluginTriggerService.update_plugin_trigger(
            app_id=app_model.id,
            node_id=args["node_id"],
            subscription_id=args["subscription_id"],
        )

        return jsonable_encoder(plugin_trigger)

    @setup_required
    @login_required
    @account_initialization_required
    @get_app_model(mode=AppMode.WORKFLOW)
    def delete(self, app_model):
        """Delete plugin trigger"""
        parser = reqparse.RequestParser()
        parser.add_argument("node_id", type=str, required=True, help="Node ID is required")
        args = parser.parse_args()

        assert isinstance(current_user, Account)
        assert current_user.current_tenant_id is not None
        if not current_user.is_editor:
            raise Forbidden()

        WorkflowPluginTriggerService.delete_plugin_trigger(
            app_id=app_model.id,
            node_id=args["node_id"],
        )

        return {"result": "success"}, 204


class WebhookTriggerApi(Resource):
    """Webhook Trigger API"""

    @setup_required
    @login_required
    @account_initialization_required
    @get_app_model(mode=AppMode.WORKFLOW)
    @marshal_with(webhook_trigger_fields)
    def get(self, app_model):
        """Get webhook trigger for a node"""
        parser = reqparse.RequestParser()
        parser.add_argument("node_id", type=str, required=True, help="Node ID is required")
        args = parser.parse_args()

        node_id = args["node_id"]

        with Session(db.engine) as session:
            # Get webhook trigger for this app and node
            webhook_trigger = (
                session.query(WorkflowWebhookTrigger)
                .filter(
                    WorkflowWebhookTrigger.app_id == app_model.id,
                    WorkflowWebhookTrigger.node_id == node_id,
                )
                .first()
            )

            if not webhook_trigger:
                raise NotFound("Webhook trigger not found for this node")

            # Add computed fields for marshal_with
            base_url = dify_config.SERVICE_API_URL
            webhook_trigger.webhook_url = f"{base_url}/triggers/webhook/{webhook_trigger.webhook_id}"  # type: ignore
            webhook_trigger.webhook_debug_url = f"{base_url}/triggers/webhook-debug/{webhook_trigger.webhook_id}"  # type: ignore

            return webhook_trigger


class AppTriggersApi(Resource):
    """App Triggers list API"""

    @setup_required
    @login_required
    @account_initialization_required
    @get_app_model(mode=AppMode.WORKFLOW)
    @marshal_with(triggers_list_fields)
    def get(self, app_model):
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

        # Add computed icon field for each trigger
        url_prefix = dify_config.CONSOLE_API_URL + "/console/api/workspaces/current/tool-provider/builtin/"
        for trigger in triggers:
            if trigger.trigger_type == "trigger-plugin":
                trigger.icon = url_prefix + trigger.provider_name + "/icon"  # type: ignore
            else:
                trigger.icon = ""  # type: ignore

        return {"data": triggers}


class AppTriggerEnableApi(Resource):
    @setup_required
    @login_required
    @account_initialization_required
    @get_app_model(mode=AppMode.WORKFLOW)
    @marshal_with(trigger_fields)
    def post(self, app_model):
        """Update app trigger (enable/disable)"""
        parser = reqparse.RequestParser()
        parser.add_argument("trigger_id", type=str, required=True, nullable=False, location="json")
        parser.add_argument("enable_trigger", type=bool, required=True, nullable=False, location="json")
        args = parser.parse_args()

        assert isinstance(current_user, Account)
        assert current_user.current_tenant_id is not None
        if not current_user.is_editor:
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

        # Add computed icon field
        url_prefix = dify_config.CONSOLE_API_URL + "/console/api/workspaces/current/tool-provider/builtin/"
        if trigger.trigger_type == "trigger-plugin":
            trigger.icon = url_prefix + trigger.provider_name + "/icon"  # type: ignore
        else:
            trigger.icon = ""  # type: ignore

        return trigger


api.add_resource(WebhookTriggerApi, "/apps/<uuid:app_id>/workflows/triggers/webhook")
api.add_resource(PluginTriggerApi, "/apps/<uuid:app_id>/workflows/triggers/plugin")
api.add_resource(AppTriggersApi, "/apps/<uuid:app_id>/triggers")
api.add_resource(AppTriggerEnableApi, "/apps/<uuid:app_id>/trigger-enable")
