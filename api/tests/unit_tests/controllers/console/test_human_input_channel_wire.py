from __future__ import annotations

from collections.abc import Iterator
from typing import Never

import pytest
from flask import Flask
from werkzeug.local import LocalProxy

from configs import dify_config
from controllers.console import bp as console_bp
from controllers.console.human_input_v2 import channel as channel_controller
from controllers.console.human_input_v2.config_version import encode_im_config_version
from controllers.console.wraps import _is_setup_completed
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
_BASE_PATH = "/console/api/workspace/current/human-input/v2"
_EXPECTED_ROUTES = {
    f"{_BASE_PATH}/channel-providers": {"GET"},
    f"{_BASE_PATH}/channels": {"GET"},
    f"{_BASE_PATH}/channels/email": {"POST"},
    f"{_BASE_PATH}/channels/email/test": {"POST"},
    f"{_BASE_PATH}/channels/email/<uuid:channel_id>": {"DELETE", "GET", "PUT"},
    f"{_BASE_PATH}/channels/im": {"POST"},
    f"{_BASE_PATH}/channels/im/test": {"POST"},
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


@pytest.fixture
def wire_app(monkeypatch: pytest.MonkeyPatch) -> Iterator[Flask]:
    account = Account(name="Owner", email="owner@example.com", status=AccountStatus.ACTIVE)
    account.id = "account-1"
    account.role = TenantAccountRole.OWNER
    _is_setup_completed.mark_success()

    monkeypatch.setattr(dify_config, "LOGIN_DISABLED", True)
    monkeypatch.setattr(dify_config, "RBAC_ENABLED", True)
    monkeypatch.setattr("libs.login.current_user", LocalProxy(lambda: account))
    monkeypatch.setattr(
        "controllers.console.wraps.current_account_with_tenant",
        lambda: AccountWithTenant(account=account, tenant_id="workspace-1"),
    )

    application = Flask(__name__)
    application.config["TESTING"] = False
    application.config["RESTX_ERROR_404_HELP"] = False
    application.register_blueprint(console_bp)
    return application


def test_console_blueprint_registers_only_the_canonical_channel_routes(wire_app: Flask) -> None:
    registered_routes = {
        rule.rule: set(rule.methods) - {"HEAD", "OPTIONS"}
        for rule in wire_app.url_map.iter_rules()
        if rule.rule.startswith(_BASE_PATH)
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
        def update(self, *_args):
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
        def get(self, *_args):
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
        def create(self, *_args):
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
        def test(self, *_args):
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
        def test(self, *_args):
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
    }


_CANONICAL_REQUESTS = (
    ("GET", f"{_BASE_PATH}/channel-providers"),
    ("GET", f"{_BASE_PATH}/channels"),
    ("POST", f"{_BASE_PATH}/channels/email"),
    ("POST", f"{_BASE_PATH}/channels/email/test"),
    ("GET", f"{_BASE_PATH}/channels/email/{_CHANNEL_ID}"),
    ("PUT", f"{_BASE_PATH}/channels/email/{_CHANNEL_ID}"),
    ("DELETE", f"{_BASE_PATH}/channels/email/{_CHANNEL_ID}"),
    ("POST", f"{_BASE_PATH}/channels/im"),
    ("POST", f"{_BASE_PATH}/channels/im/test"),
    ("GET", f"{_BASE_PATH}/channels/im/{_CHANNEL_ID}"),
    ("PUT", f"{_BASE_PATH}/channels/im/{_CHANNEL_ID}"),
    ("DELETE", f"{_BASE_PATH}/channels/im/{_CHANNEL_ID}"),
    ("POST", f"{_BASE_PATH}/channels/im/{_CHANNEL_ID}/replacement"),
)


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
