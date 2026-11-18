from __future__ import annotations

from datetime import datetime
from typing import Never

import pytest
from flask import Flask
from flask_login import LoginManager
from werkzeug.local import LocalProxy

from configs import dify_config
from controllers.console import bp as console_bp
from controllers.console.human_input_v2 import channel as channel_controller
from controllers.console.human_input_v2.config_version import encode_im_config_version
from controllers.console.wraps import _is_setup_completed
from core.human_input_v2.im_integration.adapters.entities import (
    CredentialTestFailure,
    CredentialTestFailureKind,
    CredentialTestRejectedError,
)
from enums import DeploymentEdition
from libs.login import AccountWithTenant
from models.account import Account, AccountStatus, TenantAccountRole
from repositories.human_input_v2.im_channel_repository import IMChannelId
from services.human_input_v2.errors import (
    ChannelAlreadyConfiguredError,
    ChannelNotFoundError,
    ChannelProviderError,
    ProviderConfigurationUpdatedError,
    ProviderFailureKind,
    ReplacementRequiredError,
)

_CHANNEL_ID = "00000000-0000-0000-0000-000000000001"
_BASE_PATH = "/console/api/workspaces/current/human-input/v2"
_EXPECTED_ROUTES = {
    f"{_BASE_PATH}/channel-providers": {"GET"},
    f"{_BASE_PATH}/channels": {"GET"},
    f"{_BASE_PATH}/channels/email": {"POST"},
    f"{_BASE_PATH}/channels/email/test": {"POST"},
    f"{_BASE_PATH}/channels/email/<uuid:channel_id>/test": {"POST"},
    f"{_BASE_PATH}/channels/email/<uuid:channel_id>": {"DELETE", "GET", "PUT"},
    f"{_BASE_PATH}/channels/im": {"POST"},
    f"{_BASE_PATH}/channels/im/test": {"POST"},
    f"{_BASE_PATH}/channels/im/<uuid:channel_id>/test": {"POST"},
    f"{_BASE_PATH}/channels/im/<uuid:channel_id>": {"DELETE", "GET", "PUT"},
    f"{_BASE_PATH}/channels/im/<uuid:channel_id>/replacement": {"POST"},
}
_SLACK_CREDENTIALS = {
    "provider": "slack",
    "client_id": "client-id",
    "client_secret": "client-secret",
    "signing_secret": "signing-secret",
    "bot_token": "xoxb-bot-token",
    "app_token": "xapp-app-token",
}


@pytest.fixture(scope="module")
def console_app() -> Flask:
    """One app with the whole console blueprint, which takes a few hundred milliseconds to register."""
    application = Flask(__name__)
    LoginManager().init_app(application)
    application.config["TESTING"] = False
    application.config["RESTX_ERROR_404_HELP"] = False
    application.register_blueprint(console_bp)
    return application


@pytest.fixture
def wire_app(console_app: Flask, monkeypatch: pytest.MonkeyPatch) -> Flask:
    account = Account(name="Owner", email="owner@example.com", status=AccountStatus.ACTIVE)
    account.id = "account-1"
    account.role = TenantAccountRole.OWNER
    _is_setup_completed.mark_success()

    monkeypatch.setattr(dify_config, "LOGIN_DISABLED", True)
    monkeypatch.setattr(dify_config, "DEPLOYMENT_EDITION", DeploymentEdition.CLOUD)
    monkeypatch.setattr(dify_config, "RBAC_ENABLED", True)
    monkeypatch.setattr("libs.login.current_user", LocalProxy(lambda: account))
    monkeypatch.setattr(
        "controllers.console.wraps.current_account_with_tenant",
        lambda: AccountWithTenant(account=account, tenant_id="workspace-1"),
    )
    return console_app


def test_console_blueprint_registers_only_the_canonical_channel_routes(wire_app: Flask) -> None:
    registered_routes = {
        rule.rule: set(rule.methods or ()) - {"HEAD", "OPTIONS"}
        for rule in wire_app.url_map.iter_rules()
        if rule.rule.startswith(f"{_BASE_PATH}/channel")
    }

    assert registered_routes == _EXPECTED_ROUTES


def test_legacy_management_paths_are_route_level_not_found(
    wire_app: Flask,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    build_calls: list[str] = []
    monkeypatch.setattr(
        channel_controller,
        "build_human_input_email_channel_management_service",
        lambda: build_calls.append("email"),
    )
    monkeypatch.setattr(
        channel_controller,
        "_workspace_im_channel_service",
        lambda: build_calls.append("im"),
    )

    client = wire_app.test_client()
    responses = [
        client.get("/console/api/workspaces/current/human-input/im-integration"),
        client.post("/console/api/workspaces/current/human-input/im-integration/test", json={}),
    ]

    assert [response.status_code for response in responses] == [404, 404]
    assert build_calls == []


@pytest.mark.parametrize(
    ("error", "expected_code"),
    [
        (ReplacementRequiredError("provider-secret"), "replacement_required"),
        (ProviderConfigurationUpdatedError("database-detail"), "provider_configuration_updated"),
    ],
)
def test_im_update_conflicts_have_stable_wire_codes(
    wire_app: Flask,
    monkeypatch: pytest.MonkeyPatch,
    error: Exception,
    expected_code: str,
) -> None:
    class IMOwner:
        def update(self, *_args: object) -> Never:
            raise error

    monkeypatch.setattr(
        channel_controller,
        "_workspace_im_channel_service",
        lambda *_args: IMOwner(),
    )

    response = wire_app.test_client().put(
        f"{_BASE_PATH}/channels/im/{_CHANNEL_ID}",
        json={
            "credentials": _SLACK_CREDENTIALS,
            "expected_config_version": encode_im_config_version(IMChannelId(_CHANNEL_ID), 1),
        },
    )

    assert response.status_code == 409
    assert response.get_json() == {
        "code": expected_code,
        "message": (
            "Explicit IM Channel replacement is required."
            if expected_code == "replacement_required"
            else "The Channel configuration was updated."
        ),
        "status": 409,
    }
    assert "provider-secret" not in response.get_data(as_text=True)
    assert "database-detail" not in response.get_data(as_text=True)


def test_kind_mismatch_is_a_detail_free_wire_not_found(
    wire_app: Flask,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    class EmailOwner:
        def get(self, *_args: object) -> Never:
            raise ChannelNotFoundError("the channel belongs to another kind and scope")

    monkeypatch.setattr(
        channel_controller,
        "build_human_input_email_channel_management_service",
        EmailOwner,
    )

    response = wire_app.test_client().get(f"{_BASE_PATH}/channels/email/{_CHANNEL_ID}")

    assert response.status_code == 404
    response_body = response.get_json()
    assert response_body["status"] == 404
    assert response_body["message"] == "Channel not found."
    assert "another kind" not in response.get_data(as_text=True)


def test_existing_im_create_is_a_generic_conflict_without_a_third_code(
    wire_app: Flask,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    class IMOwner:
        def create(self, *_args: object) -> Never:
            raise ChannelAlreadyConfiguredError("persistence-conflict-detail")

    monkeypatch.setattr(
        channel_controller,
        "_workspace_im_channel_service",
        lambda *_args: IMOwner(),
    )

    response = wire_app.test_client().post(
        f"{_BASE_PATH}/channels/im",
        json={"credentials": _SLACK_CREDENTIALS},
    )

    assert response.status_code == 409
    response_body = response.get_json()
    assert response_body["status"] == 409
    assert response_body["message"] == "A Channel is already configured for this kind."
    assert response_body["code"] == "conflict"
    assert "persistence-conflict-detail" not in response.get_data(as_text=True)


def test_unexpected_candidate_failure_is_a_detail_free_wire_internal_error(
    wire_app: Flask,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    service_error = RuntimeError("provider-adapter-secret-diagnostic")

    class IMOwner:
        def test(self, *_args: object) -> Never:
            raise service_error

    monkeypatch.setattr(
        channel_controller,
        "_workspace_im_channel_service",
        lambda *_args: IMOwner(),
    )

    response = wire_app.test_client().post(
        f"{_BASE_PATH}/channels/im/test",
        json={"credentials": _SLACK_CREDENTIALS},
    )

    assert response.status_code == 500
    response_body = response.get_json()
    assert response_body["status"] == 500
    assert response_body["message"] == "Internal Server Error"
    assert "provider-adapter-secret-diagnostic" not in response.get_data(as_text=True)


@pytest.mark.parametrize(
    "failure_kind",
    [ProviderFailureKind.INVALID_CREDENTIALS, ProviderFailureKind.CONNECTION_FAILURE],
)
def test_candidate_provider_failures_are_credential_free_test_outcomes(
    wire_app: Flask,
    monkeypatch: pytest.MonkeyPatch,
    failure_kind: ProviderFailureKind,
) -> None:
    class IMOwner:
        def test(self, *_args: object) -> Never:
            raise ChannelProviderError(failure_kind, f"Safe {failure_kind.value} description.")

    monkeypatch.setattr(
        channel_controller,
        "_workspace_im_channel_service",
        lambda *_args: IMOwner(),
    )

    response = wire_app.test_client().post(
        f"{_BASE_PATH}/channels/im/test",
        json={"credentials": _SLACK_CREDENTIALS},
    )

    assert response.status_code == 200
    assert response.get_json() == {
        "status": failure_kind.value,
        "status_description": f"Safe {failure_kind.value} description.",
        "provider_error_code": None,
        "provider_request_id": None,
    }


@pytest.mark.parametrize("operation", ["test", "saved_test", "create", "update", "replacement"])
@pytest.mark.parametrize("request_id", [None, "9592fb05-8aaa-4210-a062-a51cb6198185"])
def test_adapter_error_diagnostics_reach_the_final_api_response(
    wire_app: Flask, monkeypatch: pytest.MonkeyPatch, operation: str, request_id: str | None
) -> None:
    error = CredentialTestRejectedError(
        CredentialTestFailure(
            CredentialTestFailureKind.AUTHENTICATION_REJECTED,
            "Check the configured Tenant ID.",
            provider_error_code="AADSTS90002",
            http_status=400,
            provider_request_id=request_id,
        )
    )

    class IMOwner:
        def test(self, *_args: object) -> Never:
            raise error

        test_saved = test
        create = test
        update = test
        replace = test

    monkeypatch.setattr(channel_controller, "_workspace_im_channel_service", lambda *_args: IMOwner())
    paths = {
        "test": ("POST", "/test"),
        "saved_test": ("POST", f"/{_CHANNEL_ID}/test"),
        "create": ("POST", ""),
        "update": ("PUT", f"/{_CHANNEL_ID}"),
        "replacement": ("POST", f"/{_CHANNEL_ID}/replacement"),
    }
    method, suffix = paths[operation]
    payload: dict[str, object] = {"credentials": _SLACK_CREDENTIALS}
    if operation in {"saved_test", "update", "replacement"}:
        payload["expected_config_version"] = encode_im_config_version(IMChannelId(_CHANNEL_ID), 1)
    response = wire_app.test_client().open(f"{_BASE_PATH}/channels/im{suffix}", method=method, json=payload)

    testing = operation in {"test", "saved_test"}
    assert response.status_code == (200 if testing else 400)
    body = response.get_json()
    assert body["provider_error_code"] == "AADSTS90002"
    assert body["provider_request_id"] == request_id
    description = body["status_description"] if testing else body["message"]
    assert description.startswith("Check the configured Tenant ID.")
    assert "AADSTS90002" in description
    if request_id is None:
        assert "Request ID:" not in description
        assert body["provider_request_id"] is None
    else:
        assert request_id in description


_CANONICAL_REQUESTS = (
    ("GET", f"{_BASE_PATH}/channel-providers"),
    ("GET", f"{_BASE_PATH}/channels"),
    ("POST", f"{_BASE_PATH}/channels/email"),
    ("POST", f"{_BASE_PATH}/channels/email/test"),
    ("POST", f"{_BASE_PATH}/channels/email/{_CHANNEL_ID}/test"),
    ("GET", f"{_BASE_PATH}/channels/email/{_CHANNEL_ID}"),
    ("PUT", f"{_BASE_PATH}/channels/email/{_CHANNEL_ID}"),
    ("DELETE", f"{_BASE_PATH}/channels/email/{_CHANNEL_ID}"),
    ("POST", f"{_BASE_PATH}/channels/im"),
    ("POST", f"{_BASE_PATH}/channels/im/test"),
    ("POST", f"{_BASE_PATH}/channels/im/{_CHANNEL_ID}/test"),
    ("GET", f"{_BASE_PATH}/channels/im/{_CHANNEL_ID}"),
    ("PUT", f"{_BASE_PATH}/channels/im/{_CHANNEL_ID}"),
    ("DELETE", f"{_BASE_PATH}/channels/im/{_CHANNEL_ID}"),
    ("POST", f"{_BASE_PATH}/channels/im/{_CHANNEL_ID}/replacement"),
)


@pytest.mark.parametrize(
    ("method", "path"),
    [request for request in _CANONICAL_REQUESTS if "/channels/email" in request[1]],
)
@pytest.mark.parametrize("authenticated", [False, True])
def test_community_rejects_email_management_before_authentication_and_dispatch(
    wire_app: Flask,
    monkeypatch: pytest.MonkeyPatch,
    method: str,
    path: str,
    authenticated: bool,
) -> None:
    def unexpected_authentication() -> Never:
        raise AssertionError("disabled Email management must not resolve authentication")

    def unexpected_service() -> Never:
        raise AssertionError("disabled Email management must not read, write or send through its owner")

    monkeypatch.setattr(dify_config, "DEPLOYMENT_EDITION", DeploymentEdition.COMMUNITY)
    monkeypatch.setattr(dify_config, "LOGIN_DISABLED", authenticated)
    monkeypatch.setattr("libs.login._resolve_current_user", unexpected_authentication)
    monkeypatch.setattr(channel_controller, "build_human_input_email_channel_management_service", unexpected_service)

    response = wire_app.test_client().open(path, method=method, json={"unexpected": "invalid-candidate"})

    assert response.status_code == 501


@pytest.mark.parametrize("path", ["channel-providers", "channels"])
@pytest.mark.parametrize("mail_type", [None, "resend"])
def test_community_discovery_exposes_only_im_channels(
    wire_app: Flask,
    monkeypatch: pytest.MonkeyPatch,
    path: str,
    mail_type: str | None,
) -> None:
    from core.human_input_v2.entities import IMProvider
    from repositories.human_input_v2.im_channel_repository import IMChannelStatus
    from services.human_input_v2.im_channel_service import IMChannelView

    im_channel = IMChannelView(
        id=IMChannelId(_CHANNEL_ID),
        created_at=datetime(2026, 11, 17),
        updated_at=datetime(2026, 11, 17),
        provider=IMProvider.FEISHU,
        status=IMChannelStatus.CONNECTED,
        status_reason=None,
        app_identifier="feishu-app",
        webhook_url=None,
        config_version=1,
    )

    class IMOwner:
        def available_providers(self) -> tuple[IMProvider, ...]:
            return (IMProvider.FEISHU,)

        def get_current(self) -> IMChannelView:
            return im_channel

    def unexpected_email_owner() -> Never:
        raise AssertionError("Community discovery must not access tenant Email configuration")

    monkeypatch.setattr(dify_config, "DEPLOYMENT_EDITION", DeploymentEdition.COMMUNITY)
    monkeypatch.setattr(dify_config, "MAIL_TYPE", mail_type)
    monkeypatch.setattr(
        channel_controller, "build_human_input_email_channel_management_service", unexpected_email_owner
    )
    monkeypatch.setattr(channel_controller, "_workspace_im_channel_service", lambda *_args: IMOwner())

    response = wire_app.test_client().get(f"{_BASE_PATH}/{path}")

    assert response.status_code == 200
    if path == "channel-providers":
        assert response.get_json() == {
            "email_providers": [],
            "im_providers": [{"provider": "feishu", "connection_mode": "custom_app"}],
        }
    else:
        channels = response.get_json()["channels"]
        assert [(channel["kind"], channel["id"]) for channel in channels] == [("im", _CHANNEL_ID)]


@pytest.mark.parametrize(("method", "path"), _CANONICAL_REQUESTS)
def test_enterprise_rejects_every_canonical_path_before_auth_dto_and_service(
    wire_app: Flask,
    monkeypatch: pytest.MonkeyPatch,
    method: str,
    path: str,
) -> None:
    def unexpected_authentication() -> None:
        raise AssertionError("authentication must not run before edition admission")

    def unexpected_service(*_args: object) -> Never:
        raise AssertionError("service composition must not run before edition admission")

    monkeypatch.setattr(dify_config, "DEPLOYMENT_EDITION", DeploymentEdition.ENTERPRISE)
    monkeypatch.setattr(dify_config, "LOGIN_DISABLED", False)
    monkeypatch.setattr("libs.login._resolve_current_user", unexpected_authentication)
    monkeypatch.setattr(
        channel_controller,
        "build_human_input_email_channel_management_service",
        unexpected_service,
    )
    monkeypatch.setattr(channel_controller, "_workspace_im_channel_service", unexpected_service)

    response = wire_app.test_client().open(path, method=method, json={"event_transport_mode": "STREAM"})

    assert response.status_code == 501


@pytest.mark.parametrize("edition", [DeploymentEdition.COMMUNITY, DeploymentEdition.CLOUD])
def test_workspace_editions_continue_to_the_existing_authentication_stack(
    wire_app: Flask,
    monkeypatch: pytest.MonkeyPatch,
    edition: DeploymentEdition,
) -> None:
    monkeypatch.setattr(dify_config, "DEPLOYMENT_EDITION", edition)
    monkeypatch.setattr(dify_config, "LOGIN_DISABLED", False)
    monkeypatch.setattr("libs.login._resolve_current_user", lambda: None)

    response = wire_app.test_client().get(f"{_BASE_PATH}/channel-providers")

    assert response.status_code == 401


@pytest.mark.parametrize("kind", ["im", "email"])
def test_saved_connection_test_accepts_retention_without_saving(
    wire_app: Flask, monkeypatch: pytest.MonkeyPatch, kind: str
) -> None:
    from controllers.console.human_input_v2.config_version import encode_email_config_version
    from core.human_input_v2.shared import EmailProviderId
    from repositories.human_input_v2.email_channel import EmailConfigurationSnapshot

    tested: list[object] = []

    class Owner:
        def test_saved(self, *args: object) -> None:
            tested.append(args[-1])

    monkeypatch.setattr(channel_controller, "_workspace_im_channel_service", lambda *_args: Owner())
    monkeypatch.setattr(channel_controller, "build_human_input_email_channel_management_service", Owner)
    credentials = (
        {name: value if name == "provider" else {"type": "unchanged"} for name, value in _SLACK_CREDENTIALS.items()}
        if kind == "im"
        else {
            "provider": "resend",
            "api_key": {"type": "unchanged"},
        }
    )
    version = (
        encode_im_config_version(IMChannelId(_CHANNEL_ID), 1)
        if kind == "im"
        else encode_email_config_version(EmailConfigurationSnapshot(EmailProviderId(_CHANNEL_ID), 1))
    )

    body = {"expected_config_version": version, "credentials": credentials}
    if kind == "email":
        body.update({"sender_email": {"type": "unchanged"}, "sender_name": {"type": "unchanged"}})
    response = wire_app.test_client().post(
        f"{_BASE_PATH}/channels/{kind}/{_CHANNEL_ID}/test",
        json=body,
    )

    assert response.status_code == 200
    assert response.get_json() == {
        "status": "connected",
        "status_description": "",
        "provider_error_code": None,
        "provider_request_id": None,
    }
    assert len(tested) == 1


@pytest.mark.parametrize("kind", ["im", "email"])
@pytest.mark.parametrize(
    ("failure", "expected_status", "expected_code"),
    [
        (ChannelNotFoundError("private-owner"), 404, "not_found"),
        (ProviderConfigurationUpdatedError("private-version"), 409, "provider_configuration_updated"),
        (ChannelProviderError(ProviderFailureKind.INVALID_CREDENTIALS, "Invalid credentials."), 200, None),
    ],
)
def test_saved_connection_test_translates_failures_safely(
    wire_app: Flask,
    monkeypatch: pytest.MonkeyPatch,
    kind: str,
    failure: Exception,
    expected_status: int,
    expected_code: str | None,
) -> None:
    from controllers.console.human_input_v2.config_version import encode_email_config_version
    from core.human_input_v2.shared import EmailProviderId
    from repositories.human_input_v2.email_channel import EmailConfigurationSnapshot

    class Owner:
        def test_saved(self, *_args: object) -> Never:
            raise failure

    monkeypatch.setattr(channel_controller, "_workspace_im_channel_service", lambda *_args: Owner())
    monkeypatch.setattr(channel_controller, "build_human_input_email_channel_management_service", Owner)
    credentials = (
        _SLACK_CREDENTIALS
        if kind == "im"
        else {
            "provider": "resend",
            "api_key": "api-key",
        }
    )
    version = (
        encode_im_config_version(IMChannelId(_CHANNEL_ID), 1)
        if kind == "im"
        else encode_email_config_version(EmailConfigurationSnapshot(EmailProviderId(_CHANNEL_ID), 1))
    )
    body = {"expected_config_version": version, "credentials": credentials}
    if kind == "email":
        body.update({"sender_email": {"type": "unchanged"}, "sender_name": {"type": "unchanged"}})
    response = wire_app.test_client().post(
        f"{_BASE_PATH}/channels/{kind}/{_CHANNEL_ID}/test",
        json=body,
    )

    assert response.status_code == expected_status
    if expected_code is not None:
        assert response.get_json()["code"] == expected_code
    else:
        assert response.get_json() == {
            "status": "invalid_credentials",
            "status_description": "Invalid credentials.",
            "provider_error_code": None,
            "provider_request_id": None,
        }
    assert "private-" not in response.get_data(as_text=True)


def test_im_detail_returns_identifiers_and_redacted_secret_states(
    wire_app: Flask,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from datetime import datetime

    from core.human_input_v2.entities import IMProvider
    from core.human_input_v2.im_integration.adapters.credentials import FeishuCredentials
    from repositories.human_input_v2.im_channel_repository import IMChannelStatus
    from services.human_input_v2.im_channel_service import IMChannelDetailView, IMChannelView

    view = IMChannelView(
        id=IMChannelId(_CHANNEL_ID),
        created_at=datetime(2026, 10, 15),
        updated_at=datetime(2026, 10, 15),
        provider=IMProvider.FEISHU,
        status=IMChannelStatus.CONNECTED,
        status_reason=None,
        app_identifier="app",
        webhook_url=None,
        config_version=1,
    )

    class Owner:
        def get_detail(self, _channel_id: IMChannelId) -> IMChannelDetailView:
            return IMChannelDetailView(
                view,
                FeishuCredentials(
                    provider=IMProvider.FEISHU,
                    app_id="feishu-app-id",
                    app_secret="stored-app-secret",
                    verification_token=None,
                    encrypt_key="stored-encrypt-key",
                ),
            )

    monkeypatch.setattr(channel_controller, "_workspace_im_channel_service", lambda *_args: Owner())
    response = wire_app.test_client().get(f"{_BASE_PATH}/channels/im/{_CHANNEL_ID}")

    assert response.status_code == 200
    assert response.get_json()["credentials"] == {
        "provider": "feishu",
        "app_id": "feishu-app-id",
        "app_secret": {"type": "redacted"},
        "verification_token": None,
        "encrypt_key": {"type": "redacted"},
    }
    assert "stored-app-secret" not in response.get_data(as_text=True)
    assert "stored-encrypt-key" not in response.get_data(as_text=True)


def test_saved_im_test_rejects_provider_mismatch_as_bad_request(
    wire_app: Flask, monkeypatch: pytest.MonkeyPatch
) -> None:
    class Owner:
        def test_saved(self, *_args: object) -> Never:
            raise ReplacementRequiredError("private-provider-mismatch")

    monkeypatch.setattr(channel_controller, "_workspace_im_channel_service", lambda *_args: Owner())
    response = wire_app.test_client().post(
        f"{_BASE_PATH}/channels/im/{_CHANNEL_ID}/test",
        json={
            "expected_config_version": encode_im_config_version(IMChannelId(_CHANNEL_ID), 1),
            "credentials": {
                "provider": "feishu",
                "app_id": {"type": "unchanged"},
                "app_secret": {"type": "unchanged"},
                "verification_token": {"type": "unchanged"},
                "encrypt_key": {"type": "unchanged"},
            },
        },
    )

    assert response.status_code == 400
    assert response.get_json()["code"] == "bad_request"
    assert "private-provider-mismatch" not in response.get_data(as_text=True)


@pytest.mark.parametrize("kind", ["im", "email"])
@pytest.mark.parametrize("saved", [False, True])
@pytest.mark.parametrize("request_id", ["DT-Request:ABC/42", "  vendor\nrequest\x00  ", None])
def test_provider_diagnostics_are_structured_test_results(
    wire_app: Flask, monkeypatch: pytest.MonkeyPatch, kind: str, saved: bool, request_id: str | None
) -> None:
    from controllers.console.human_input_v2.config_version import encode_email_config_version
    from core.human_input_v2.shared import EmailProviderId
    from repositories.human_input_v2.email_channel import EmailConfigurationSnapshot

    failure = ChannelProviderError(
        ProviderFailureKind.CONNECTION_FAILURE,
        "Provider rejected the request.",
        provider_error_code="40013",
        provider_request_id=request_id,
        http_status=500,
    )

    class Owner:
        def test(self, *_args: object) -> Never:
            raise failure

        def test_saved(self, *_args: object) -> Never:
            raise failure

    monkeypatch.setattr(channel_controller, "_workspace_im_channel_service", lambda *_args: Owner())
    monkeypatch.setattr(channel_controller, "build_human_input_email_channel_management_service", Owner)
    credentials = _SLACK_CREDENTIALS if kind == "im" else {"provider": "resend", "api_key": "fake-secret"}
    body: dict[str, object] = {"credentials": credentials}
    if kind == "email":
        body.update({"sender_email": "sender@example.com", "sender_name": "Dify"})
    if saved:
        body["expected_config_version"] = (
            encode_im_config_version(IMChannelId(_CHANNEL_ID), 1)
            if kind == "im"
            else encode_email_config_version(EmailConfigurationSnapshot(EmailProviderId(_CHANNEL_ID), 1))
        )
    suffix = f"/{_CHANNEL_ID}/test" if saved else "/test"
    response = wire_app.test_client().post(
        f"{_BASE_PATH}/channels/{kind}{suffix}", json=body, headers={"X-Request-Id": "dify-local-request"}
    )

    assert response.status_code == 200
    assert response.get_json() == {
        "status": "connection_failure",
        "status_description": failure.status_description,
        "provider_error_code": "40013",
        "provider_request_id": request_id,
    }
    assert "dify-local-request" not in response.get_data(as_text=True)


@pytest.mark.parametrize("operation", ["create", "update", "replace"])
@pytest.mark.parametrize("request_id", ["DT-Request:ABC/42", "  vendor\nrequest\x00  ", None])
def test_im_mutation_errors_expose_original_provider_diagnostics(
    wire_app: Flask, monkeypatch: pytest.MonkeyPatch, operation: str, request_id: str | None
) -> None:
    failure = ChannelProviderError(
        ProviderFailureKind.CONNECTION_FAILURE,
        "Provider rejected the request.",
        provider_error_code="40013",
        provider_request_id=request_id,
    )

    class Owner:
        def create(self, *_args: object) -> Never:
            raise failure

        def update(self, *_args: object) -> Never:
            raise failure

        def replace(self, *_args: object) -> Never:
            raise failure

    monkeypatch.setattr(channel_controller, "_workspace_im_channel_service", lambda *_args: Owner())
    body: dict[str, object] = {"credentials": _SLACK_CREDENTIALS}
    path = f"{_BASE_PATH}/channels/im"
    if operation != "create":
        body["expected_config_version"] = encode_im_config_version(IMChannelId(_CHANNEL_ID), 1)
        path += f"/{_CHANNEL_ID}"
    if operation == "replace":
        path += "/replacement"
    response = wire_app.test_client().open(path, method="PUT" if operation == "update" else "POST", json=body)

    assert response.status_code == 400
    assert response.get_json() == {
        "code": "bad_request",
        "message": failure.status_description,
        "status": 400,
        "provider_error_code": "40013",
        "provider_request_id": request_id,
    }
