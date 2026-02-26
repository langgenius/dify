import logging

from flask import request
from flask_restx import Resource, fields, marshal_with
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.orm import Session
from werkzeug.exceptions import NotFound

from configs import dify_config
from controllers.common.schema import get_or_create_model
from extensions.ext_database import db
from fields.workflow_trigger_fields import trigger_fields, triggers_list_fields, webhook_trigger_fields
from libs.login import current_user, login_required
from models.enums import AppTriggerStatus
from models.model import Account, App, AppMode
from models.trigger import AppTrigger, WorkflowWebhookTrigger

from .. import console_ns
from ..app.wraps import get_app_model
from ..wraps import account_initialization_required, edit_permission_required, setup_required

logger = logging.getLogger(__name__)
DEFAULT_REF_TEMPLATE_SWAGGER_2_0 = "#/definitions/{model}"

trigger_model = get_or_create_model("WorkflowTrigger", trigger_fields)

triggers_list_fields_copy = triggers_list_fields.copy()
triggers_list_fields_copy["data"] = fields.List(fields.Nested(trigger_model))
triggers_list_model = get_or_create_model("WorkflowTriggerList", triggers_list_fields_copy)

webhook_trigger_model = get_or_create_model("WebhookTrigger", webhook_trigger_fields)


class Parser(BaseModel):
    node_id: str


class ParserEnable(BaseModel):
    trigger_id: str
    enable_trigger: bool


console_ns.schema_model(Parser.__name__, Parser.model_json_schema(ref_template=DEFAULT_REF_TEMPLATE_SWAGGER_2_0))

console_ns.schema_model(
    ParserEnable.__name__, ParserEnable.model_json_schema(ref_template=DEFAULT_REF_TEMPLATE_SWAGGER_2_0)
)


@console_ns.route("/apps/<uuid:app_id>/workflows/triggers/webhook")
class WebhookTriggerApi(Resource):
    """Webhook Trigger API"""

    @console_ns.expect(console_ns.models[Parser.__name__])
    @setup_required
    @login_required
    @account_initialization_required
    @get_app_model(mode=AppMode.WORKFLOW)
    @marshal_with(webhook_trigger_model)
    def get(self, app_model: App):
        """Get webhook trigger for a node"""
        args = Parser.model_validate(request.args.to_dict(flat=True))  # type: ignore

        node_id = args.node_id

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


@console_ns.route("/apps/<uuid:app_id>/triggers")
class AppTriggersApi(Resource):
    """App Triggers list API"""

    @setup_required
    @login_required
    @account_initialization_required
    @get_app_model(mode=AppMode.WORKFLOW)
    @marshal_with(triggers_list_model)
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


@console_ns.route("/apps/<uuid:app_id>/trigger-enable")
class AppTriggerEnableApi(Resource):
    @console_ns.expect(console_ns.models[ParserEnable.__name__])
    @setup_required
    @login_required
    @account_initialization_required
    @edit_permission_required
    @get_app_model(mode=AppMode.WORKFLOW)
    @marshal_with(trigger_model)
    def post(self, app_model: App):
        """Update app trigger (enable/disable)"""
        args = ParserEnable.model_validate(console_ns.payload)

        assert current_user.current_tenant_id is not None

        trigger_id = args.trigger_id
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
            trigger.status = AppTriggerStatus.ENABLED if args.enable_trigger else AppTriggerStatus.DISABLED

            session.commit()
            session.refresh(trigger)

        # Add computed icon field
        url_prefix = dify_config.CONSOLE_API_URL + "/console/api/workspaces/current/tool-provider/builtin/"
        if trigger.trigger_type == "trigger-plugin":
            trigger.icon = url_prefix + trigger.provider_name + "/icon"  # type: ignore
        else:
            trigger.icon = ""  # type: ignore

        return trigger
