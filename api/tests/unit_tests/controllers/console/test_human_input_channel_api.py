from __future__ import annotations

import importlib
from datetime import datetime
from http import HTTPStatus
from inspect import unwrap
from types import SimpleNamespace
from unittest.mock import patch
from uuid import UUID

import pytest
from flask import Flask, g
from werkzeug.exceptions import Forbidden

from controllers.console.human_input_v2.config_version import encode_email_config_version
from controllers.console.wraps import _is_setup_completed
from core.human_input_v2.entities import EmailProviderType, IMProvider
from core.human_input_v2.shared import EmailProviderId
from libs.exception import BaseHTTPException
from models.account import Account, AccountStatus, TenantAccountRole
from repositories.human_input_v2.email_channel import EmailChannelView, EmailConfigurationSnapshot
from repositories.human_input_v2.im_channel_repository import IMChannelId, IMChannelStatus
from services.human_input_v2.errors import (
    ChannelAlreadyConfiguredError,
    ChannelNotFoundError,
    ChannelProviderError,
    ProviderConfigurationUpdatedError,
    ProviderFailureKind,
    ReplacementRequiredError,
    UnexpectedChannelProviderError,
)
from services.human_input_v2.im_channel_service import IMChannelView

_CANONICAL_ROUTES = {
    "/workspace/current/human-input/v2/channel-providers": {"GET"},
    "/workspace/current/human-input/v2/channels": {"GET"},
    "/workspace/current/human-input/v2/channels/email": {"POST"},
    "/workspace/current/human-input/v2/channels/email/test": {"POST"},
    "/workspace/current/human-input/v2/channels/email/<uuid:channel_id>": {"GET", "PUT", "DELETE"},
    "/workspace/current/human-input/v2/channels/im": {"POST"},
    "/workspace/current/human-input/v2/channels/im/test": {"POST"},
    "/workspace/current/human-input/v2/channels/im/<uuid:channel_id>": {"GET", "PUT", "DELETE"},
    "/workspace/current/human-input/v2/channels/im/<uuid:channel_id>/replacement": {"POST"},
}


def test_human_input_channel_controller_imports_successfully() -> None:
    try:
        importlib.import_module("controllers.console.human_input_v2.channel")
    except (ImportError, SyntaxError) as error:
        raise AssertionError("the canonical Human Input Channel controller must be importable") from error


def test_canonical_route_inventory_has_no_kind_specific_discovery_authority() -> None:
    module = importlib.import_module("controllers.console.human_input_v2.channel")
    registered_routes: dict[str, set[str]] = {}

    for resource, urls, _route_doc, _kwargs in module.console_ns.resources:
        resource_methods = {
            method.upper() for method in ("get", "post", "put", "patch", "delete") if method in resource.__dict__
        }
        for url in urls:
            if url.startswith("/workspace/current/human-input/v2"):
                registered_routes[url] = resource_methods

    assert registered_routes == _CANONICAL_ROUTES
    assert "/workspace/current/human-input/v2/channels/email" not in {
        route for route, methods in registered_routes.items() if "GET" in methods
    }
    assert "/workspace/current/human-input/v2/channels/im" not in {
        route for route, methods in registered_routes.items() if "GET" in methods
    }


def test_channel_transport_models_match_the_canonical_schema() -> None:
    module = importlib.import_module("controllers.console.human_input_v2.channel")

    assert set(module.ChannelSummary.model_fields) == {
        "id",
        "created_at",
        "updated_at",
        "kind",
        "provider",
        "status",
        "status_description",
        "display_identifier",
        "webhook_url",
        "config_version",
    }
    assert {status.value for status in module.ChannelStatus} == {
        "connected",
        "invalid_credentials",
        "connection_failure",
    }
    assert set(module.ChannelTestResponse.model_fields) == {"status", "status_description"}
    assert set(module.ListChannelProvidersResponse.model_fields) == {"email_providers", "im_providers"}
    assert set(module.ChannelProvider.model_fields) == {"provider", "connection_mode"}
    assert set(module.ChannelDeleteResponse.model_fields) == {"channel_id"}
    assert set(module.EmailChannelTestPayload.model_fields) == {"credentials"}
    assert set(module.EmailChannelCreatePayload.model_fields) == {"credentials"}
    assert set(module.EmailChannelUpdatePayload.model_fields) == {
        "credentials",
        "expected_config_version",
    }
    assert set(module.IMChannelTestPayload.model_fields) == {"credentials"}
    assert set(module.IMChannelCreatePayload.model_fields) == {"credentials"}
    assert set(module.IMChannelUpdatePayload.model_fields) == {
        "credentials",
        "expected_config_version",
    }
    assert set(module.IMChannelReplacementPayload.model_fields) == {
        "credentials",
        "expected_config_version",
    }
    assert set(module.ChannelDeleteQuery.model_fields) == {"expected_config_version"}
    assert all(
        "channel_id" not in request_model.model_fields
        for request_model in (
            module.EmailChannelTestPayload,
            module.EmailChannelCreatePayload,
            module.EmailChannelUpdatePayload,
            module.IMChannelTestPayload,
            module.IMChannelCreatePayload,
            module.IMChannelUpdatePayload,
            module.IMChannelReplacementPayload,
            module.ChannelDeleteQuery,
        )
    )
    assert set(module.ChannelConflictResponse.model_fields["code"].annotation.__args__) == {
        "replacement_required",
        "provider_configuration_updated",
    }

    schema = module.ChannelSummary.model_json_schema()
    config_version_ref = schema["properties"]["config_version"]["$ref"]
    config_version_name = config_version_ref.rsplit("/", 1)[-1]
    assert schema["$defs"][config_version_name]["type"] == "string"
    assert "last_checked_at" not in schema["properties"]
    assert set(module.ListChannelsResponse.model_fields) == {"channels"}
    assert set(module.EmailChannelMutationResponse.model_fields) == {"summary"}
    assert set(module.IMChannelMutationResponse.model_fields) == {"summary"}


def test_legacy_im_management_routes_are_not_registered() -> None:
    from controllers.console import console_ns

    registered_urls = {url for _resource, urls, _route_doc, _kwargs in console_ns.resources for url in urls}

    assert "/workspaces/current/human-input/im-integration" not in registered_urls
    assert "/workspaces/current/human-input/im-integration/test" not in registered_urls


def test_conflict_response_exposes_only_the_two_stable_codes() -> None:
    module = importlib.import_module("controllers.console.human_input_v2.channel")

    replacement = module.ChannelConflictResponse(
        code="replacement_required",
        message="Explicit replacement is required.",
        status=HTTPStatus.CONFLICT,
    )
    stale = module.ChannelConflictResponse(
        code="provider_configuration_updated",
        message="The channel configuration was updated.",
        status=HTTPStatus.CONFLICT,
    )

    assert replacement.status == HTTPStatus.CONFLICT
    assert stale.status == HTTPStatus.CONFLICT


def test_kind_mismatch_is_a_generic_not_found_response(
    app: Flask,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    module = importlib.import_module("controllers.console.human_input_v2.channel")
    service_error = ChannelNotFoundError("the identifier belongs to another kind")

    class EmailOwner:
        def get(self, _scope, _channel_id):
            raise service_error

    monkeypatch.setattr(
        module,
        "build_human_input_email_channel_management_service",
        EmailOwner,
    )

    with app.test_request_context(method="GET"), pytest.raises(BaseHTTPException) as error_info:
        unwrap(module.EmailChannelApi.get)(
            module.EmailChannelApi(),
            "workspace-1",
            UUID("00000000-0000-0000-0000-000000000001"),
        )

    assert error_info.value.code == HTTPStatus.NOT_FOUND
    assert "another kind" not in str(error_info.value.description)
    assert error_info.value.__cause__ is service_error


@pytest.mark.parametrize(
    ("service_error", "expected_status", "expected_error_code", "expected_description"),
    [
        (
            ChannelAlreadyConfiguredError("persistence-conflict-detail"),
            HTTPStatus.CONFLICT,
            "conflict",
            "A Channel is already configured for this kind.",
        ),
        (
            ChannelProviderError(ProviderFailureKind.CONNECTION_FAILURE, "Provider connection failed."),
            HTTPStatus.BAD_REQUEST,
            "bad_request",
            "Provider connection failed.",
        ),
    ],
)
def test_email_create_translates_expected_errors_with_cause(
    app: Flask,
    monkeypatch: pytest.MonkeyPatch,
    service_error: Exception,
    expected_status: HTTPStatus,
    expected_error_code: str,
    expected_description: str,
) -> None:
    module = importlib.import_module("controllers.console.human_input_v2.channel")

    class EmailOwner:
        def create(self, *_args):
            raise service_error

    monkeypatch.setattr(module, "build_human_input_email_channel_management_service", EmailOwner)
    account = Account(name="Owner", email="owner@example.com", status=AccountStatus.ACTIVE)
    account.id = "account-1"

    with (
        app.test_request_context(
            method="POST",
            json={
                "credentials": {
                    "provider": "resend",
                    "sender_email": "sender@example.com",
                    "sender_name": "Dify",
                    "api_key": "resend-secret",
                }
            },
        ),
        pytest.raises(BaseHTTPException) as error_info,
    ):
        unwrap(module.EmailChannelCreateApi.post)(
            module.EmailChannelCreateApi(),
            "workspace-1",
            account,
        )

    assert error_info.value.code == expected_status
    assert error_info.value.description == expected_description
    assert error_info.value.data == {
        "code": expected_error_code,
        "message": expected_description,
        "status": expected_status,
    }
    assert error_info.value.__cause__ is service_error


@pytest.mark.parametrize(
    ("service_error", "expected_error_code", "expected_description"),
    [
        (
            ReplacementRequiredError("provider-secret"),
            "replacement_required",
            "Explicit IM Channel replacement is required.",
        ),
        (
            ProviderConfigurationUpdatedError("database-detail"),
            "provider_configuration_updated",
            "The Channel configuration was updated.",
        ),
    ],
)
def test_im_update_translates_conflicts_with_cause(
    app: Flask,
    monkeypatch: pytest.MonkeyPatch,
    service_error: Exception,
    expected_error_code: str,
    expected_description: str,
) -> None:
    module = importlib.import_module("controllers.console.human_input_v2.channel")
    config_version = importlib.import_module("controllers.console.human_input_v2.config_version")
    channel_id = IMChannelId("00000000-0000-0000-0000-000000000001")

    class IMOwner:
        def update(self, *_args):
            raise service_error

    monkeypatch.setattr(module, "_workspace_im_channel_service", lambda *_args: IMOwner())
    account = Account(name="Owner", email="owner@example.com", status=AccountStatus.ACTIVE)
    account.id = "account-1"

    with (
        app.test_request_context(
            method="PUT",
            json={
                "credentials": {
                    "provider": "slack",
                    "client_id": "client-id",
                    "client_secret": "client-secret",
                    "signing_secret": "signing-secret",
                    "bot_token": "xoxb-bot-token",
                    "app_token": "xapp-app-token",
                },
                "expected_config_version": config_version.encode_im_config_version(channel_id, 1),
            },
        ),
        pytest.raises(BaseHTTPException) as error_info,
    ):
        unwrap(module.IMChannelApi.put)(
            module.IMChannelApi(),
            "workspace-1",
            account,
            UUID(str(channel_id)),
        )

    assert error_info.value.data == {
        "code": expected_error_code,
        "message": expected_description,
        "status": HTTPStatus.CONFLICT,
    }
    assert error_info.value.__cause__ is service_error


def test_im_update_decodes_the_opaque_version_before_calling_the_owner(
    app: Flask,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    module = importlib.import_module("controllers.console.human_input_v2.channel")
    config_version = importlib.import_module("controllers.console.human_input_v2.config_version")
    channel_id = IMChannelId("00000000-0000-0000-0000-000000000001")
    expected_config_version = 7

    class IMOwner:
        def update(self, addressed_id, config_version, _credentials):
            assert addressed_id == channel_id
            assert config_version == expected_config_version
            raise ReplacementRequiredError("replacement required")

    monkeypatch.setattr(module, "_workspace_im_channel_service", lambda *_args: IMOwner())
    account = Account(name="Owner", email="owner@example.com", status=AccountStatus.ACTIVE)
    account.id = "account-1"

    with (
        app.test_request_context(
            method="PUT",
            json={
                "credentials": {
                    "provider": "slack",
                    "client_id": "client-id",
                    "client_secret": "client-secret",
                    "signing_secret": "signing-secret",
                    "bot_token": "xoxb-bot-token",
                    "app_token": "xapp-app-token",
                },
                "expected_config_version": config_version.encode_im_config_version(
                    channel_id,
                    expected_config_version,
                ),
            },
        ),
        pytest.raises(BaseHTTPException) as error_info,
    ):
        unwrap(module.IMChannelApi.put)(module.IMChannelApi(), "workspace-1", account, UUID(str(channel_id)))

    assert error_info.value.error_code == "replacement_required"


def test_unexpected_provider_error_is_not_rewrapped(
    app: Flask,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    module = importlib.import_module("controllers.console.human_input_v2.channel")
    service_error = UnexpectedChannelProviderError()

    class EmailOwner:
        def create(self, *_args):
            raise service_error

    monkeypatch.setattr(module, "build_human_input_email_channel_management_service", EmailOwner)
    account = Account(name="Owner", email="owner@example.com", status=AccountStatus.ACTIVE)
    account.id = "account-1"

    with (
        app.test_request_context(
            method="POST",
            json={
                "credentials": {
                    "provider": "resend",
                    "sender_email": "sender@example.com",
                    "sender_name": "Dify",
                    "api_key": "resend-secret",
                }
            },
        ),
        pytest.raises(UnexpectedChannelProviderError) as error_info,
    ):
        unwrap(module.EmailChannelCreateApi.post)(
            module.EmailChannelCreateApi(),
            "workspace-1",
            account,
        )

    assert error_info.value is service_error


def test_create_returns_the_resulting_canonical_summary(
    app: Flask,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    module = importlib.import_module("controllers.console.human_input_v2.channel")
    revision = EmailConfigurationSnapshot(
        EmailProviderId("00000000-0000-0000-0000-000000000001"),
        1,
    )
    snapshot = EmailChannelView(
        id=EmailProviderId("00000000-0000-0000-0000-000000000001"),
        created_at=datetime(2026, 8, 20, 8),
        updated_at=datetime(2026, 8, 20, 9),
        provider=EmailProviderType.RESEND,
        sender_name="Dify",
        sender_email="sender@example.com",
        revision=revision,
    )

    class EmailOwner:
        def create(self, scope, actor_account_id, candidate):
            assert str(scope.id) == "workspace-1"
            assert str(actor_account_id) == "account-1"
            assert candidate.sender_name == "Dify"
            return snapshot

    monkeypatch.setattr(
        module,
        "build_human_input_email_channel_management_service",
        EmailOwner,
    )
    account = Account(name="Owner", email="owner@example.com", status=AccountStatus.ACTIVE)
    account.id = "account-1"

    with app.test_request_context(
        method="POST",
        json={
            "credentials": {
                "provider": "resend",
                "sender_email": "sender@example.com",
                "sender_name": "Dify",
                "api_key": "resend-secret",
            }
        },
    ):
        response = unwrap(module.EmailChannelCreateApi.post)(
            module.EmailChannelCreateApi(),
            "workspace-1",
            account,
        )

    assert response == {
        "summary": {
            "id": "00000000-0000-0000-0000-000000000001",
            "created_at": 1787184000,
            "updated_at": 1787187600,
            "kind": "email",
            "provider": "resend",
            "status": "connected",
            "status_description": "",
            "display_identifier": "Dify sender@example.com",
            "webhook_url": None,
            "config_version": encode_email_config_version(revision),
        }
    }
    assert "resend-secret" not in repr(response)


def test_channel_collection_aggregates_configured_owner_snapshots(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    module = importlib.import_module("controllers.console.human_input_v2.channel")
    email_snapshot = EmailChannelView(
        id=EmailProviderId("email-1"),
        created_at=datetime(2026, 8, 20, 8),
        updated_at=datetime(2026, 8, 20, 9),
        provider=EmailProviderType.RESEND,
        sender_name="Dify",
        sender_email="sender@example.com",
        revision=EmailConfigurationSnapshot(EmailProviderId("email-1"), 1),
    )
    im_snapshot = IMChannelView(
        id=IMChannelId("im-1"),
        created_at=datetime(2026, 8, 20, 8),
        updated_at=datetime(2026, 8, 20, 9),
        provider=IMProvider.SLACK,
        status=IMChannelStatus.CONNECTION_FAILURE,
        status_reason="Provider connection failed.",
        app_identifier="client-1",
        webhook_url=None,
        config_version=1,
    )

    class EmailOwner:
        def get_current(self, scope):
            assert str(scope.id) == "workspace-1"
            return email_snapshot

    class IMOwner:
        def get_current(self):
            return im_snapshot

    monkeypatch.setattr(module, "build_human_input_email_channel_management_service", EmailOwner)
    monkeypatch.setattr(module, "_workspace_im_channel_service", lambda *_args: IMOwner())
    account = Account(name="Owner", email="owner@example.com", status=AccountStatus.ACTIVE)
    account.id = "account-1"

    response = unwrap(module.ListChannelsApi.get)(module.ListChannelsApi(), "workspace-1", account)

    assert isinstance(response, dict)
    assert [channel["kind"] for channel in response["channels"]] == ["email", "im"]
    assert [channel["display_identifier"] for channel in response["channels"]] == [
        "Dify sender@example.com",
        "client-1",
    ]


def test_channel_collection_omits_unconfigured_owner_snapshots(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    module = importlib.import_module("controllers.console.human_input_v2.channel")

    class EmailOwner:
        def get_current(self, _scope):
            return None

    class IMOwner:
        def get_current(self):
            return None

    monkeypatch.setattr(module, "build_human_input_email_channel_management_service", EmailOwner)
    monkeypatch.setattr(module, "_workspace_im_channel_service", lambda *_args: IMOwner())
    account = Account(name="Owner", email="owner@example.com", status=AccountStatus.ACTIVE)
    account.id = "account-1"

    response = unwrap(module.ListChannelsApi.get)(module.ListChannelsApi(), "workspace-1", account)

    assert response == {"channels": []}


def test_composite_guard_rejects_a_non_admin_workspace_member(
    app: Flask,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    module = importlib.import_module("controllers.console.human_input_v2.channel")
    account = Account(name="Editor", email="editor@example.com", status=AccountStatus.ACTIVE)
    account._current_tenant = SimpleNamespace(id="workspace-1")
    account.role = TenantAccountRole.EDITOR
    _is_setup_completed.mark_success()

    build_calls: list[str] = []
    monkeypatch.setattr(
        module,
        "build_human_input_email_channel_management_service",
        lambda: build_calls.append("email"),
    )
    monkeypatch.setattr(
        module,
        "_workspace_im_channel_service",
        lambda *_args: build_calls.append("im"),
    )

    with (
        app.test_request_context(method="GET"),
        patch("controllers.console.wraps.dify_config.RBAC_ENABLED", True),
        patch("libs.login.check_csrf_token", return_value=None),
    ):
        g._login_user = account
        with pytest.raises(Forbidden):
            module.ListChannelProvidersApi().get()
    assert build_calls == []


def test_composite_guard_allows_a_workspace_owner(
    app: Flask,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    module = importlib.import_module("controllers.console.human_input_v2.channel")
    account = Account(name="Owner", email="owner@example.com", status=AccountStatus.ACTIVE)
    account._current_tenant = SimpleNamespace(id="workspace-1")
    account.role = TenantAccountRole.OWNER
    _is_setup_completed.mark_success()

    class EmailOwner:
        def available_providers(self):
            return (EmailProviderType.RESEND,)

    class IMOwner:
        def available_providers(self):
            return ()

    monkeypatch.setattr(module, "build_human_input_email_channel_management_service", EmailOwner)
    monkeypatch.setattr(module, "_workspace_im_channel_service", lambda *_args: IMOwner())

    with (
        app.test_request_context(method="GET"),
        patch("controllers.console.wraps.dify_config.RBAC_ENABLED", False),
        patch("libs.login.check_csrf_token", return_value=None),
    ):
        g._login_user = account
        response = module.ListChannelProvidersApi().get()

    assert response == {
        "email_providers": [{"provider": "resend", "connection_mode": "custom_app"}],
        "im_providers": [],
    }
