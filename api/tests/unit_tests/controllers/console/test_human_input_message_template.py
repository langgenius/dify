"""Message-template test requests dispatch through both draft routes."""

from collections.abc import Mapping
from inspect import unwrap
from typing import Never

import pytest
from flask import Flask
from pydantic import JsonValue
from sqlalchemy.orm import sessionmaker

from controllers.console.app import workflow_human_input_v2 as controller
from core.human_input_v2.entities import DebugChannel
from core.human_input_v2.im_integration.adapters.protocols import IMProviderAdapter
from core.human_input_v2.shared import AccountId, TenantId
from graphon.variable_loader import VariableLoader
from models.account import Account
from models.model import App
from repositories.human_input_v2.email_channel.repository import SQLAlchemyEmailChannelRepository
from repositories.human_input_v2.im_channel_repository import IMChannel
from services.human_input_v2.form_service import HumanInputDeliveryTestFormService
from services.human_input_v2.message_template_test_service import MessageTemplateTestService
from services.human_input_v2.resend_channel import ResendProviderGateway


@pytest.fixture
def template_service() -> MessageTemplateTestService:
    sessions = sessionmaker()

    def build_adapter(_channel: IMChannel) -> IMProviderAdapter:
        raise AssertionError("Controller dispatch must not resolve a provider")

    def variable_loader(app_id: str) -> VariableLoader:
        raise AssertionError(f"Controller dispatch must not load variables for {app_id}")

    return MessageTemplateTestService(
        session_factory=sessions,
        tenant_id=TenantId("tenant-id"),
        account_id=AccountId("editor-id"),
        account_email="editor@example.com",
        email_repository_factory=SQLAlchemyEmailChannelRepository,
        email_gateway=ResendProviderGateway(),
        im_adapter_factory=build_adapter,
        form_service=HumanInputDeliveryTestFormService(
            session_factory=sessions,
            tenant_id=TenantId("tenant-id"),
            account_id=AccountId("editor-id"),
            variable_loader_factory=variable_loader,
        ),
    )


@pytest.mark.parametrize(
    "resource",
    [controller.WorkflowDraftMessageTemplateTestApi, controller.AdvancedChatDraftMessageTemplateTestApi],
)
def test_template_test_dispatches_for_current_editor(
    template_service: MessageTemplateTestService,
    monkeypatch: pytest.MonkeyPatch,
    resource: type[controller.WorkflowDraftMessageTemplateTestApi | controller.AdvancedChatDraftMessageTemplateTestApi],
) -> None:
    builder_calls: list[tuple[str, str, str]] = []
    sends: list[tuple[str, str, DebugChannel, dict[str, JsonValue]]] = []

    def build(*, tenant_id: str, account_id: str, account_email: str) -> MessageTemplateTestService:
        builder_calls.append((tenant_id, account_id, account_email))
        return template_service

    def send(
        _self: MessageTemplateTestService,
        *,
        app_id: str,
        node_id: str,
        channel: DebugChannel,
        inputs: Mapping[str, JsonValue],
    ) -> None:
        sends.append((app_id, node_id, channel, dict(inputs)))

    monkeypatch.setattr(controller, "build_message_template_test_service", build)
    monkeypatch.setattr(MessageTemplateTestService, "send_test", send)
    account = Account(name="Editor", email="editor@example.com")
    account.id = "editor-id"
    app_model = App(id="app-id", tenant_id="tenant-id")
    application = Flask(__name__)

    with application.test_request_context(json={"channel": "email", "inputs": {"#start.name#": "Alice"}}):
        response = unwrap(resource.post)(resource(), account, app_model, "approval")

    assert response == {}
    assert builder_calls == [("tenant-id", "editor-id", "editor@example.com")]
    assert sends == [("app-id", "approval", DebugChannel.EMAIL, {"#start.name#": "Alice"})]


@pytest.mark.parametrize(
    ("error", "status", "code"),
    [
        (controller.MessageTemplateTestError("No channel."), 400, "message_template_test_invalid"),
        (controller.MessageTemplateSendError("Provider failed."), 502, "message_template_test_send_failed"),
    ],
)
def test_send_failures_have_explicit_http_errors(
    template_service: MessageTemplateTestService,
    monkeypatch: pytest.MonkeyPatch,
    error: Exception,
    status: int,
    code: str,
) -> None:
    def fail(
        _self: MessageTemplateTestService,
        *,
        app_id: str,
        node_id: str,
        channel: DebugChannel,
        inputs: Mapping[str, JsonValue],
    ) -> Never:
        assert (app_id, node_id, channel, dict(inputs)) == ("app-id", "approval", DebugChannel.SLACK, {})
        raise error

    monkeypatch.setattr(MessageTemplateTestService, "send_test", fail)
    monkeypatch.setattr(controller, "build_message_template_test_service", lambda **_kwargs: template_service)
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

    def unexpected_build(**_kwargs: str) -> Never:
        raise AssertionError("Unauthenticated requests must not build the service")

    monkeypatch.setattr(controller, "build_message_template_test_service", unexpected_build)
    application = Flask(__name__)
    LoginManager(application)
    application.register_blueprint(console_bp)

    response = application.test_client().post(
        f"/console/api/apps/00000000-0000-0000-0000-000000000001/{prefix}"
        "/draft/human-input/nodes/approval/message-template/test",
        json={"invalid": "payload"},
    )

    assert response.status_code == 401
