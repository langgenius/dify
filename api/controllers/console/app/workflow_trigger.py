import logging
import secrets
from flask_restful import Resource, reqparse
from sqlalchemy.orm import Session
from werkzeug.exceptions import NotFound, BadRequest, Forbidden

from controllers.console import api
from controllers.console.app.wraps import get_app_model
from controllers.console.wraps import account_initialization_required, setup_required
from extensions.ext_database import db
from libs.login import current_user, login_required
from models.workflow import WorkflowWebhookTrigger
from configs import dify_config


logger = logging.getLogger(__name__)


class WebhookTriggerApi(Resource):
    """Webhook Trigger API"""

    @setup_required
    @login_required
    @account_initialization_required
    @get_app_model
    def post(self, app_model):
        """Create webhook trigger"""
        parser = reqparse.RequestParser()
        parser.add_argument("node_id", type=str, required=True, help="Node ID is required")
        parser.add_argument(
            "triggered_by",
            type=str,
            required=False,
            default="production",
            choices=["debugger", "production"],
            help="triggered_by must be debugger or production",
        )
        args = parser.parse_args()

        if app_model.mode != "workflow":
            raise BadRequest("Invalid app mode, only workflow can add webhook node")

        # The role of the current user in the ta table must be admin, owner, or editor
        if not current_user.is_editor:
            raise Forbidden()

        node_id = args["node_id"]
        triggered_by = args["triggered_by"]

        with Session(db.engine) as session:
            # Check if webhook trigger already exists for this app, node, and environment
            existing_trigger = (
                session.query(WorkflowWebhookTrigger)
                .filter(
                    WorkflowWebhookTrigger.app_id == app_model.id,
                    WorkflowWebhookTrigger.node_id == node_id,
                    WorkflowWebhookTrigger.triggered_by == triggered_by,
                )
                .first()
            )

            if existing_trigger:
                raise BadRequest("Webhook trigger already exists for this node and environment")

            # Generate unique webhook_id
            webhook_id = self._generate_webhook_id(session)

            # Create new webhook trigger
            webhook_trigger = WorkflowWebhookTrigger(
                app_id=app_model.id,
                node_id=node_id,
                tenant_id=current_user.current_tenant_id,
                webhook_id=webhook_id,
                triggered_by=triggered_by,
            )

            session.add(webhook_trigger)
            session.commit()
            session.refresh(webhook_trigger)

        return {
            "id": webhook_trigger.id,
            "webhook_id": webhook_trigger.webhook_id,
            "webhook_url": f"{dify_config.SERVICE_API_URL}/triggers/webhook/{webhook_trigger.webhook_id}",
            "node_id": webhook_trigger.node_id,
            "triggered_by": webhook_trigger.triggered_by,
            "created_at": webhook_trigger.created_at.isoformat(),
        }

    @setup_required
    @login_required
    @account_initialization_required
    @get_app_model
    def delete(self, app_model):
        """Delete webhook trigger"""
        parser = reqparse.RequestParser()
        parser.add_argument("node_id", type=str, required=True, help="Node ID is required")
        parser.add_argument(
            "triggered_by",
            type=str,
            required=False,
            default="production",
            choices=["debugger", "production"],
            help="triggered_by must be debugger or production",
        )
        args = parser.parse_args()

        # The role of the current user in the ta table must be admin, owner, or editor
        if not current_user.is_editor:
            raise Forbidden()

        node_id = args["node_id"]
        triggered_by = args["triggered_by"]

        with Session(db.engine) as session:
            # Find webhook trigger
            webhook_trigger = (
                session.query(WorkflowWebhookTrigger)
                .filter(
                    WorkflowWebhookTrigger.app_id == app_model.id,
                    WorkflowWebhookTrigger.node_id == node_id,
                    WorkflowWebhookTrigger.triggered_by == triggered_by,
                    WorkflowWebhookTrigger.tenant_id == current_user.current_tenant_id,
                )
                .first()
            )

            if not webhook_trigger:
                raise NotFound("Webhook trigger not found")

            session.delete(webhook_trigger)
            session.commit()

        return {"result": "success"}, 204

    def _generate_webhook_id(self, session: Session) -> str:
        """Generate unique 24-character webhook ID"""
        while True:
            # Generate 24-character random string
            webhook_id = secrets.token_urlsafe(18)[:24]  # token_urlsafe gives base64url, take first 24 chars

            # Check if it already exists
            existing = (
                session.query(WorkflowWebhookTrigger).filter(WorkflowWebhookTrigger.webhook_id == webhook_id).first()
            )

            if not existing:
                return webhook_id


api.add_resource(WebhookTriggerApi, "/apps/<uuid:app_id>/workflows/triggers/webhook")
