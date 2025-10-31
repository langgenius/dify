import logging

from flask_restx import Resource, marshal_with, reqparse
from sqlalchemy import select
from sqlalchemy.orm import Session
from werkzeug.exceptions import Forbidden, NotFound

from configs import dify_config
from controllers.console import api
from controllers.console.app.wraps import get_app_model
from controllers.console.wraps import account_initialization_required, setup_required
from extensions.ext_database import db
from fields.workflow_trigger_fields import trigger_fields, triggers_list_fields, webhook_trigger_fields
from libs.login import current_user, login_required
from models.enums import AppTriggerStatus
from models.model import Account, App, AppMode
from models.trigger import AppTrigger, WorkflowWebhookTrigger

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

        # Add computed icon field
        url_prefix = dify_config.CONSOLE_API_URL + "/console/api/workspaces/current/tool-provider/builtin/"
        if trigger.trigger_type == "trigger-plugin":
            trigger.icon = url_prefix + trigger.provider_name + "/icon"  # type: ignore
        else:
            trigger.icon = ""  # type: ignore

        return trigger


api.add_resource(WebhookTriggerApi, "/apps/<uuid:app_id>/workflows/triggers/webhook")
api.add_resource(AppTriggersApi, "/apps/<uuid:app_id>/triggers")
api.add_resource(AppTriggerEnableApi, "/apps/<uuid:app_id>/trigger-enable")
