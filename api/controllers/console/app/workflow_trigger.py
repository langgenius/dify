from dataclasses import asdict
from datetime import datetime
from http import HTTPStatus
from uuid import UUID

from flask_restx import Resource
from pydantic import BaseModel, field_validator

from configs import dify_config
from controllers.common.rbac import PlainApp, RBACCheck
from controllers.common.schema import query_params_from_model, register_response_schema_models, register_schema_models
from controllers.console import console_ns
from controllers.console.app.error import AppNotFoundError, AppTriggerNotFoundError, WebhookTriggerNotFoundError
from controllers.console.flask_admission import console_account_admission
from controllers.console.wraps import RBACPermission, model_validate
from core.trigger.utils.endpoint import generate_webhook_trigger_endpoint
from enums.account import TenantAccountRole
from extensions.ext_application_services import application_services
from fields.base import ResponseModel
from libs.external_api import error_responses
from libs.helper import dump_response
from machinery.context import RequestContext
from models.enums import AppTriggerType
from services.app.console_service import ConsoleAppNotFoundError
from services.trigger.app_trigger_store import (
    AppTriggerNotFoundError as AppTriggerMissing,
)
from services.trigger.app_trigger_store import (
    AppTriggerRecord,
)
from services.trigger.app_trigger_store import (
    WebhookTriggerNotFoundError as WebhookTriggerMissing,
)


class WebhookTriggerQuery(BaseModel):
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


register_schema_models(console_ns, WebhookTriggerQuery, ParserEnable)
register_response_schema_models(
    console_ns,
    WorkflowTriggerResponse,
    WorkflowTriggerListResponse,
    WebhookTriggerResponse,
)


def _with_trigger_icon(trigger: AppTriggerRecord) -> dict[str, object]:
    icon = ""
    if trigger.trigger_type == AppTriggerType.TRIGGER_PLUGIN:
        icon = (
            dify_config.CONSOLE_API_URL
            + "/console/api/workspaces/current/tool-provider/builtin/"
            + (trigger.provider_name or "")
            + "/icon"
        )
    return {**asdict(trigger), "icon": icon}


@console_ns.route("/apps/<uuid:app_id>/workflows/triggers/webhook")
class WebhookTriggerApi(Resource):
    @error_responses(AppNotFoundError, WebhookTriggerNotFoundError)
    @console_ns.doc(params=query_params_from_model(WebhookTriggerQuery))
    @console_ns.response(HTTPStatus.OK, "Success", console_ns.models[WebhookTriggerResponse.__name__])
    @console_account_admission(rbac_checks=[RBACCheck(RBACPermission.APP_VIEW_LAYOUT, PlainApp())])
    @model_validate(WebhookTriggerQuery)
    def get(self, req_data: WebhookTriggerQuery, context: RequestContext, app_id: UUID) -> dict[str, object]:
        """Get webhook trigger for a node"""
        try:
            webhook = application_services().apps.triggers.get_webhook(context, str(app_id), req_data.node_id)
        except ConsoleAppNotFoundError as error:
            raise AppNotFoundError(str(error)) from error
        except WebhookTriggerMissing as error:
            raise WebhookTriggerNotFoundError(str(error)) from error
        return dump_response(
            WebhookTriggerResponse,
            {
                **asdict(webhook),
                "webhook_url": generate_webhook_trigger_endpoint(webhook.webhook_id),
                "webhook_debug_url": generate_webhook_trigger_endpoint(webhook.webhook_id, debug=True),
            },
        )


@console_ns.route("/apps/<uuid:app_id>/triggers")
class AppTriggersApi(Resource):
    @error_responses(AppNotFoundError)
    @console_ns.response(HTTPStatus.OK, "Success", console_ns.models[WorkflowTriggerListResponse.__name__])
    @console_account_admission(rbac_checks=[RBACCheck(RBACPermission.APP_VIEW_LAYOUT, PlainApp())])
    def get(self, context: RequestContext, app_id: UUID) -> dict[str, object]:
        """Get app triggers list"""
        try:
            triggers = application_services().apps.triggers.list_triggers(context, str(app_id))
        except ConsoleAppNotFoundError as error:
            raise AppNotFoundError(str(error)) from error
        return dump_response(
            WorkflowTriggerListResponse, {"data": [_with_trigger_icon(trigger) for trigger in triggers]}
        )


@console_ns.route("/apps/<uuid:app_id>/trigger-enable")
class AppTriggerEnableApi(Resource):
    @error_responses(AppNotFoundError, AppTriggerNotFoundError)
    @console_ns.expect(console_ns.models[ParserEnable.__name__])
    @console_ns.response(HTTPStatus.OK, "Success", console_ns.models[WorkflowTriggerResponse.__name__])
    @console_account_admission(
        allowed_roles=frozenset({TenantAccountRole.OWNER, TenantAccountRole.ADMIN, TenantAccountRole.EDITOR}),
        rbac_checks=[RBACCheck(RBACPermission.APP_EDIT, PlainApp())],
    )
    @model_validate(ParserEnable)
    def post(self, req_data: ParserEnable, context: RequestContext, app_id: UUID) -> dict[str, object]:
        """Update app trigger (enable/disable)"""
        try:
            trigger = application_services().apps.triggers.set_enabled(
                context, str(app_id), req_data.trigger_id, enabled=req_data.enable_trigger
            )
        except ConsoleAppNotFoundError as error:
            raise AppNotFoundError(str(error)) from error
        except AppTriggerMissing as error:
            raise AppTriggerNotFoundError(str(error)) from error
        return dump_response(WorkflowTriggerResponse, _with_trigger_icon(trigger))
