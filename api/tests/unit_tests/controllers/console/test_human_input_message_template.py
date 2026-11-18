"""Authenticated workspace channel discovery and app-scoped message-template tests."""

from collections.abc import Mapping
from inspect import unwrap
from typing import Never

import pytest
from flask import Flask, g
from flask.testing import FlaskClient
from flask_login import LoginManager
from pydantic import JsonValue
from sqlalchemy import delete
from sqlalchemy.orm import Session, sessionmaker

from configs import dify_config
from controllers.console import bp as console_bp
from controllers.console.app import workflow_human_input_v2 as controller
from controllers.console.human_input_v2 import channel as channel_controller
from core.human_input_v2.entities import DebugChannel, EmailProviderType, IMProvider
from core.human_input_v2.im_integration.adapters.protocols import IMProviderAdapter
from core.human_input_v2.shared import AccountId, TenantId
from enums import DeploymentEdition
from graphon.variable_loader import VariableLoader
from libs.key_providers.rsa_key_provider import RSAKeyProvider
from models.account import Account, AccountStatus, Tenant, TenantAccountRole
from models.human_input_v2 import HumanInputEmailProvider, HumanInputIMChannel
from models.model import App
from repositories.human_input_v2.channel_credentials import ChannelEncryptedCredentials
from repositories.human_input_v2.email_channel.repository import SQLAlchemyEmailChannelRepository
from repositories.human_input_v2.im_channel_repository import IMChannel, IMChannelStatus
from services.human_input_v2.email_channel_management_service import HumanInputEmailChannelManagementService
from services.human_input_v2.form_service import HumanInputDeliveryTestFormService
from services.human_input_v2.im_channel_service import WorkspaceIMChannelService
from services.human_input_v2.message_template_test_service import MessageTemplateTestService
from services.human_input_v2.resend_channel import ResendProviderGateway

_TEST_CHANNELS_URL = "/console/api/workspaces/current/human-input/v2/test-channels"


@pytest.fixture(scope="module")
def template_console_app() -> Flask:
    application = Flask(__name__)
    LoginManager(application)
    application.register_blueprint(console_bp)

    @application.before_request
    def authenticate() -> None:
        g._login_user = application.extensions["test_account"]

    return application


@pytest.fixture
def channel_client(
    template_console_app: Flask,
    sqlite_session_factory: sessionmaker[Session],
    monkeypatch: pytest.MonkeyPatch,
) -> tuple[FlaskClient, Account]:
    tenant = Tenant(name="Channel discovery workspace")
    account = Account(name="Editor", email="editor@example.com", status=AccountStatus.ACTIVE)
    account.role = TenantAccountRole.EDITOR
    account._current_tenant = tenant
    with sqlite_session_factory.begin() as session:
        session.add_all([tenant, account])
        session.add(
            HumanInputIMChannel(
                owner_key=f"workspace:{tenant.id}",
                provider=IMProvider.SLACK,
                provider_tenant_id="slack-workspace",
                app_identifier="slack-app",
                webhook_id="private-webhook",
                encrypted_credentials=ChannelEncryptedCredentials(ciphertext="not-decryptable"),
                status=IMChannelStatus.CONNECTED,
            )
        )
    monkeypatch.setitem(template_console_app.extensions, "test_account", account)
    monkeypatch.setattr(dify_config, "LOGIN_DISABLED", False)
    monkeypatch.setattr(dify_config, "DEPLOYMENT_EDITION", DeploymentEdition.COMMUNITY)
    monkeypatch.setattr("controllers.console.wraps._is_setup_completed", lambda: True)
    monkeypatch.setattr("libs.login.check_csrf_token", lambda *_args: None)
    monkeypatch.setattr(
        channel_controller,
        "build_workspace_im_channel_service",
        lambda tenant_id, account_id: WorkspaceIMChannelService(
            sqlite_session_factory, tenant_id, account_id, RSAKeyProvider()
        ),
    )
    monkeypatch.setattr(
        channel_controller,
        "build_human_input_email_channel_management_service",
        lambda: HumanInputEmailChannelManagementService(
            ResendProviderGateway(), session_factory=sqlite_session_factory
        ),
    )
    return template_console_app.test_client(), account


@pytest.mark.parametrize("role", list(TenantAccountRole))
@pytest.mark.parametrize("rbac_enabled", [False, True])
def test_authenticated_workspace_members_can_discover_test_channels_without_an_app(
    channel_client: tuple[FlaskClient, Account],
    monkeypatch: pytest.MonkeyPatch,
    role: TenantAccountRole,
    rbac_enabled: bool,
) -> None:
    client, account = channel_client
    account.role = role
    monkeypatch.setattr(dify_config, "RBAC_ENABLED", rbac_enabled)

    response = client.get(_TEST_CHANNELS_URL)

    assert response.status_code == 200, response.get_json()
    assert response.get_json() == {"channels": ["slack"]}
    if role not in (TenantAccountRole.OWNER, TenantAccountRole.ADMIN):
        assert client.get("/console/api/workspaces/current/human-input/v2/channels").status_code == 403


def test_test_channels_follow_the_authenticated_accounts_current_workspace(
    channel_client: tuple[FlaskClient, Account],
    sqlite_session_factory: sessionmaker[Session],
) -> None:
    client, account = channel_client
    other = Tenant(name="Another channel workspace")
    with sqlite_session_factory.begin() as session:
        session.add(other)
        session.add(
            HumanInputIMChannel(
                owner_key=f"workspace:{other.id}",
                provider=IMProvider.FEISHU,
                provider_tenant_id="feishu-workspace",
                app_identifier="feishu-app",
                webhook_id="other-webhook",
                encrypted_credentials=ChannelEncryptedCredentials(ciphertext="not-decryptable"),
                status=IMChannelStatus.CONNECTED,
            )
        )

    response = client.get(_TEST_CHANNELS_URL, query_string={"tenant_id": other.id})
    assert response.status_code == 200
    assert response.get_json() == {"channels": ["slack"]}

    account._current_tenant = other
    switched = client.get(_TEST_CHANNELS_URL)
    assert switched.status_code == 200
    assert switched.get_json() == {"channels": ["feishu"]}


@pytest.mark.parametrize("edition", [DeploymentEdition.COMMUNITY, DeploymentEdition.CLOUD])
def test_test_channel_discovery_preserves_tenant_email_capability(
    channel_client: tuple[FlaskClient, Account],
    sqlite_session_factory: sessionmaker[Session],
    monkeypatch: pytest.MonkeyPatch,
    edition: DeploymentEdition,
) -> None:
    client, account = channel_client
    monkeypatch.setattr(dify_config, "DEPLOYMENT_EDITION", edition)
    tenant_id = account.current_tenant_id
    assert tenant_id is not None
    with sqlite_session_factory.begin() as session:
        session.add(
            HumanInputEmailProvider(
                tenant_id=tenant_id,
                provider=EmailProviderType.RESEND,
                sender_email="sender@example.com",
                sender_name="Sender",
                encrypted_credentials=ChannelEncryptedCredentials(ciphertext="not-decryptable"),
            )
        )

    response = client.get(_TEST_CHANNELS_URL)

    assert response.status_code == 200, response.get_json()
    assert response.get_json() == {"channels": ["email", "slack"] if edition == DeploymentEdition.CLOUD else ["slack"]}


def test_test_channel_discovery_returns_empty_when_workspace_is_unconfigured(
    channel_client: tuple[FlaskClient, Account],
    sqlite_session_factory: sessionmaker[Session],
) -> None:
    client, account = channel_client
    with sqlite_session_factory.begin() as session:
        session.execute(
            delete(HumanInputIMChannel).where(HumanInputIMChannel.owner_key == f"workspace:{account.current_tenant_id}")
        )

    response = client.get(_TEST_CHANNELS_URL)

    assert response.status_code == 200
    assert response.get_json() == {"channels": []}


@pytest.mark.parametrize("edition", [DeploymentEdition.COMMUNITY, DeploymentEdition.ENTERPRISE])
def test_test_channel_discovery_requires_dify_authentication_before_channel_reads(
    monkeypatch: pytest.MonkeyPatch,
    edition: DeploymentEdition,
) -> None:
    monkeypatch.setattr(dify_config, "DEPLOYMENT_EDITION", edition)
    monkeypatch.setattr(dify_config, "LOGIN_DISABLED", False)
    monkeypatch.setattr("controllers.console.wraps._is_setup_completed", lambda: True)
    monkeypatch.setattr("libs.login._resolve_current_user", lambda: None)

    def unexpected_read(*_args: object, **_kwargs: object) -> Never:
        raise AssertionError("Unauthenticated requests must not read channel configuration")

    monkeypatch.setattr(channel_controller, "_workspace_im_channel_service", unexpected_read)
    monkeypatch.setattr(channel_controller, "build_human_input_email_channel_management_service", unexpected_read)
    application = Flask(__name__)
    LoginManager(application)
    application.register_blueprint(console_bp)

    response = application.test_client().get(_TEST_CHANNELS_URL)

    assert response.status_code == 401


def test_enterprise_workspace_channel_discovery_preserves_edition_admission(
    channel_client: tuple[FlaskClient, Account],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    client, _account = channel_client
    monkeypatch.setattr(dify_config, "DEPLOYMENT_EDITION", DeploymentEdition.ENTERPRISE)
    assert client.get(_TEST_CHANNELS_URL).status_code == 501


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
