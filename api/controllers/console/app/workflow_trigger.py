import logging
from datetime import datetime

from flask import request
from flask_restx import Resource
from pydantic import BaseModel, field_validator
from sqlalchemy import select
from sqlalchemy.orm import sessionmaker
from werkzeug.exceptions import NotFound

from configs import dify_config
from controllers.common.schema import register_schema_models
from extensions.ext_database import db
from fields.base import ResponseModel
from libs.login import current_user, login_required
from models.enums import AppTriggerStatus
from models.model import Account, App, AppMode
from models.trigger import AppTrigger, WorkflowWebhookTrigger

from .. import console_ns
from ..app.wraps import get_app_model
from ..wraps import account_initialization_required, edit_permission_required, setup_required

logger = logging.getLogger(__name__)


class Parser(BaseModel):
    node_id: str


class ParserEnable(BaseModel):
    trigger_id: str
    enable_trigger: bool


class WorkflowTriggerResponse(ResponseModel):
    id: str
    trigger_type: str
    title: str
    node_id: str
    provider_name: str
    icon: str
    status: str
    created_at: datetime | None = None
    updated_at: datetime | None = None

    @field_validator("id", "trigger_type", "title", "node_id", "provider_name", "icon", "status", mode="before")
    @classmethod
    def _normalize_string_fields(cls, value: object) -> str:
        if isinstance(value, str):
            return value
        return str(value)


class WorkflowTriggerListResponse(ResponseModel):
    data: list[WorkflowTriggerResponse]


class WebhookTriggerResponse(ResponseModel):
    id: str
    webhook_id: str
    webhook_url: str
    webhook_debug_url: str
    node_id: str
    created_at: datetime | None = None

    @field_validator("id", "webhook_id", "webhook_url", "webhook_debug_url", "node_id", mode="before")
    @classmethod
    def _normalize_string_fields(cls, value: object) -> str:
        if isinstance(value, str):
            return value
        return str(value)


register_schema_models(
    console_ns,
    Parser,
    ParserEnable,
    WorkflowTriggerResponse,
    WorkflowTriggerListResponse,
    WebhookTriggerResponse,
)


@console_ns.route("/apps/<uuid:app_id>/workflows/triggers/webhook")
class WebhookTriggerApi(Resource):
    """Webhook Trigger API"""

    @console_ns.expect(console_ns.models[Parser.__name__])
    @setup_required
    @login_required
    @account_initialization_required
    @get_app_model(mode=AppMode.WORKFLOW)
    @console_ns.response(200, "Success", console_ns.models[WebhookTriggerResponse.__name__])
    def get(self, app_model: App):
        """Get webhook trigger for a node"""
        args = Parser.model_validate(request.args.to_dict(flat=True))

        node_id = args.node_id

        with sessionmaker(db.engine, expire_on_commit=False).begin() as session:
            # Get webhook trigger for this app and node
            webhook_trigger = session.scalar(
                select(WorkflowWebhookTrigger)
                .where(
                    WorkflowWebhookTrigger.app_id == app_model.id,
                    WorkflowWebhookTrigger.node_id == node_id,
                )
                .limit(1)
            )

            if not webhook_trigger:
                raise NotFound("Webhook trigger not found for this node")

            return WebhookTriggerResponse.model_validate(webhook_trigger, from_attributes=True).model_dump(mode="json")


@console_ns.route("/apps/<uuid:app_id>/triggers")
class AppTriggersApi(Resource):
    """App Triggers list API"""

    @setup_required
    @login_required
    @account_initialization_required
    @get_app_model(mode=AppMode.WORKFLOW)
    @console_ns.response(200, "Success", console_ns.models[WorkflowTriggerListResponse.__name__])
    def get(self, app_model: App):
        """Get app triggers list"""
        assert isinstance(current_user, Account)
        assert current_user.current_tenant_id is not None

        with sessionmaker(db.engine, expire_on_commit=False).begin() as session:
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

        return WorkflowTriggerListResponse.model_validate({"data": triggers}, from_attributes=True).model_dump(
            mode="json"
        )


@console_ns.route("/apps/<uuid:app_id>/trigger-enable")
class AppTriggerEnableApi(Resource):
    @console_ns.expect(console_ns.models[ParserEnable.__name__])
    @setup_required
    @login_required
    @account_initialization_required
    @edit_permission_required
    @get_app_model(mode=AppMode.WORKFLOW)
    @console_ns.response(200, "Success", console_ns.models[WorkflowTriggerResponse.__name__])
    def post(self, app_model: App):
        """Update app trigger (enable/disable)"""
        args = ParserEnable.model_validate(console_ns.payload)

        assert current_user.current_tenant_id is not None

        trigger_id = args.trigger_id
        with sessionmaker(db.engine, expire_on_commit=False).begin() as session:
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

        # Add computed icon field
        url_prefix = dify_config.CONSOLE_API_URL + "/console/api/workspaces/current/tool-provider/builtin/"
        if trigger.trigger_type == "trigger-plugin":
            trigger.icon = url_prefix + trigger.provider_name + "/icon"  # type: ignore
        else:
            trigger.icon = ""  # type: ignore

        return WorkflowTriggerResponse.model_validate(trigger, from_attributes=True).model_dump(mode="json")
