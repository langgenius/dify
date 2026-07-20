"""Draft Human Input v2 workflow controller stubs."""

from __future__ import annotations

from http import HTTPStatus

from flask import abort
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
from libs.login import login_required
from models import Account
from models.model import AppMode

from .wraps import get_app_model

register_schema_models(console_ns, MessageTemplateTestRequest)
register_response_schema_models(console_ns, MessageTemplateTestResponse)


def _raise_stub_not_implemented() -> None:
    abort(HTTPStatus.NOT_IMPLEMENTED, "Human Input v2 draft stub endpoint is not implemented yet.")


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
    def post(self, current_user: Account, app_model, node_id: str):
        MessageTemplateTestRequest.model_validate(console_ns.payload or {})
        _raise_stub_not_implemented()


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
    def post(self, current_user: Account, app_model, node_id: str):
        MessageTemplateTestRequest.model_validate(console_ns.payload or {})
        _raise_stub_not_implemented()
