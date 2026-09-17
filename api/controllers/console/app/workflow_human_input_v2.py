"""Draft Human Input v2 message-template tests for the authenticated editor."""

from __future__ import annotations

from http import HTTPStatus

from flask_restx import Resource

from controllers.common.human_input_v2_contracts import (
    MessageTemplateTestRequest,
    MessageTemplateTestResponse,
)
from controllers.common.schema import register_response_schema_models, register_schema_models
from controllers.console import console_ns
from controllers.console.wraps import (
    RBACPermission,
    RBACResourceScope,
    account_initialization_required,
    edit_permission_required,
    rbac_permission_required,
    setup_required,
    with_current_user,
)
from libs.exception import BaseHTTPException
from libs.login import login_required
from models import Account
from models.model import App, AppMode
from services.human_input_v2.message_template_test_composition import build_message_template_test_service
from services.human_input_v2.message_template_test_service import MessageTemplateSendError, MessageTemplateTestError

from .wraps import get_app_model

register_schema_models(console_ns, MessageTemplateTestRequest)
register_response_schema_models(console_ns, MessageTemplateTestResponse)


class MessageTemplateTestHttpError(BaseHTTPException):
    code = HTTPStatus.BAD_REQUEST
    error_code = "message_template_test_invalid"


class MessageTemplateSendHttpError(BaseHTTPException):
    code = HTTPStatus.BAD_GATEWAY
    error_code = "message_template_test_send_failed"


def _send_test(current_user: Account, app_model: App, node_id: str) -> dict[str, object]:
    payload = MessageTemplateTestRequest.model_validate(console_ns.payload or {})
    service = build_message_template_test_service(
        tenant_id=app_model.tenant_id, account_id=current_user.id, account_email=current_user.email
    )
    try:
        service.send_test(app_id=app_model.id, node_id=node_id, channel=payload.channel, inputs=payload.inputs)
    except MessageTemplateSendError as error:
        raise MessageTemplateSendHttpError(str(error)) from None
    except MessageTemplateTestError as error:
        raise MessageTemplateTestHttpError(str(error)) from None
    return MessageTemplateTestResponse().model_dump(mode="json")


@console_ns.route("/apps/<uuid:app_id>/workflows/draft/human-input/nodes/<string:node_id>/message-template/test")
class WorkflowDraftMessageTemplateTestApi(Resource):
    @console_ns.expect(console_ns.models[MessageTemplateTestRequest.__name__])
    @console_ns.response(200, "Success", console_ns.models[MessageTemplateTestResponse.__name__])
    @setup_required
    @login_required
    @account_initialization_required
    @rbac_permission_required(RBACResourceScope.APP, RBACPermission.APP_TEST_AND_RUN)
    @get_app_model(mode=[AppMode.WORKFLOW])
    @with_current_user
    @edit_permission_required
    def post(self, current_user: Account, app_model: App, node_id: str):
        return _send_test(current_user, app_model, node_id)


@console_ns.route(
    "/apps/<uuid:app_id>/advanced-chat/workflows/draft/human-input/nodes/<string:node_id>/message-template/test"
)
class AdvancedChatDraftMessageTemplateTestApi(Resource):
    @console_ns.expect(console_ns.models[MessageTemplateTestRequest.__name__])
    @console_ns.response(200, "Success", console_ns.models[MessageTemplateTestResponse.__name__])
    @setup_required
    @login_required
    @account_initialization_required
    @rbac_permission_required(RBACResourceScope.APP, RBACPermission.APP_TEST_AND_RUN)
    @get_app_model(mode=[AppMode.ADVANCED_CHAT])
    @with_current_user
    @edit_permission_required
    def post(self, current_user: Account, app_model: App, node_id: str):
        return _send_test(current_user, app_model, node_id)
