"""Message-template test requests dispatch through both draft routes."""

from inspect import unwrap
from unittest.mock import Mock

import pytest
from flask import Flask

from controllers.console.app import workflow_human_input_v2 as controller
from models.account import Account
from models.model import App


@pytest.mark.parametrize(
    "resource",
    [controller.WorkflowDraftMessageTemplateTestApi, controller.AdvancedChatDraftMessageTemplateTestApi],
)
def test_template_test_dispatches_for_current_editor(
    monkeypatch: pytest.MonkeyPatch,
    resource: type[controller.WorkflowDraftMessageTemplateTestApi | controller.AdvancedChatDraftMessageTemplateTestApi],
) -> None:
    service = Mock()
    builder = Mock(return_value=service)
    monkeypatch.setattr(controller, "build_message_template_test_service", builder, raising=False)
    account = Account(name="Editor", email="editor@example.com")
    account.id = "editor-id"
    app_model = App(id="app-id", tenant_id="tenant-id")
    application = Flask(__name__)

    with application.test_request_context(json={"channel": "email", "inputs": {"#start.name#": "Alice"}}):
        response = unwrap(resource.post)(resource(), account, app_model, "approval")

    assert response == {}
    builder.assert_called_once_with(tenant_id="tenant-id", account_id="editor-id", account_email="editor@example.com")
    service.send_test.assert_called_once_with(
        app_id="app-id", node_id="approval", channel="email", inputs={"#start.name#": "Alice"}
    )


@pytest.mark.parametrize(
    ("error", "status", "code"),
    [
        (controller.MessageTemplateTestError("No channel."), 400, "message_template_test_invalid"),
        (controller.MessageTemplateSendError("Provider failed."), 502, "message_template_test_send_failed"),
    ],
)
def test_send_failures_have_explicit_http_errors(
    monkeypatch: pytest.MonkeyPatch,
    error: Exception,
    status: int,
    code: str,
) -> None:
    service = Mock()
    service.send_test.side_effect = error
    monkeypatch.setattr(controller, "build_message_template_test_service", Mock(return_value=service))
    account = Account(name="Editor", email="editor@example.com")
    account.id = "editor-id"
    app_model = App(id="app-id", tenant_id="tenant-id")
    with Flask(__name__).test_request_context(json={"channel": "slack"}):
        with pytest.raises(controller.BaseHTTPException) as raised:
            unwrap(controller.WorkflowDraftMessageTemplateTestApi.post)(
                controller.WorkflowDraftMessageTemplateTestApi(), account, app_model, "approval"
            )
    assert raised.value.code == status
    assert raised.value.error_code == code


@pytest.mark.parametrize("prefix", ["workflows", "advanced-chat/workflows"])
def test_enterprise_template_test_requires_authentication_without_channel_management_gate(
    monkeypatch: pytest.MonkeyPatch,
    prefix: str,
) -> None:
    from flask_login import LoginManager

    from configs import dify_config
    from controllers.console import bp as console_bp
    from enums import DeploymentEdition

    monkeypatch.setattr(dify_config, "DEPLOYMENT_EDITION", DeploymentEdition.ENTERPRISE)
    monkeypatch.setattr(dify_config, "LOGIN_DISABLED", False)
    monkeypatch.setattr("controllers.console.wraps._is_setup_completed", lambda: True)
    monkeypatch.setattr("libs.login._resolve_current_user", lambda: None)
    builder = Mock()
    monkeypatch.setattr(controller, "build_message_template_test_service", builder)
    application = Flask(__name__)
    LoginManager(application)
    application.register_blueprint(console_bp)

    response = application.test_client().post(
        f"/console/api/apps/00000000-0000-0000-0000-000000000001/{prefix}"
        "/draft/human-input/nodes/approval/message-template/test",
        json={"invalid": "payload"},
    )

    assert response.status_code == 401
    builder.assert_not_called()
