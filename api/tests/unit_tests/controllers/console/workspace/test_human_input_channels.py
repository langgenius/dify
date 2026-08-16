from __future__ import annotations

from datetime import datetime
from importlib import import_module
from inspect import unwrap
from types import SimpleNamespace

import pytest
from flask import Flask

from controllers.console import bp as console_bp
from controllers.console import console_ns
from controllers.console.workspace.human_input import (
    WorkspaceHumanInputChannelApi,
    WorkspaceHumanInputChannelsApi,
    WorkspaceHumanInputChannelTestApi,
)
from core.human_input_v2.channel_management import (
    ChannelCapability,
    ChannelCollectionResult,
    ChannelFailure,
    ChannelFailureCategory,
    ChannelKind,
    ChannelOperationResult,
    ChannelProvider,
    ChannelRef,
    ChannelScope,
    ChannelScopeKind,
    ChannelStatus,
    ChannelTestResult,
    ChannelView,
    HumanInputChannelManagementContext,
    ResendChannelSummary,
    ResendChannelTestSummary,
)
from core.human_input_v2.shared import AccountId, NormalizedEmail, TenantId
from enums.deployment_edition import DeploymentEdition

_CONTEXT = HumanInputChannelManagementContext(
    tenant_id=TenantId("workspace-1"),
    actor_account_id=AccountId("account-1"),
    actor_email=NormalizedEmail("operator@example.com"),
)
_CONTROLLER_MODULE = import_module("controllers.console.workspace.human_input")


def test_channel_routes_replace_only_obsolete_configuration_authorities() -> None:
    routes = {route for registered_resource in console_ns.resources for route in registered_resource.urls}

    assert {
        "/workspaces/current/human-input/channels",
        "/workspaces/current/human-input/channels/<string:kind>/<string:provider>",
        "/workspaces/current/human-input/channels/<string:kind>/<string:provider>/test",
        "/workspaces/current/human-input/im-integration",
        "/workspaces/current/human-input/im-integration/test",
        "/workspaces/current/human-input/contacts",
        "/workspaces/current/human-input/im-sync-runs",
        "/workspaces/current/human-input/im-sync-runs/latest/results",
        "/workspaces/current/human-input/node-data-migration",
    } <= routes
    assert "/workspaces/current/human-input/email-provider" not in routes


@pytest.mark.parametrize(
    ("method", "path"),
    [
        ("GET", "/console/api/workspaces/current/human-input/channels"),
        ("GET", "/console/api/workspaces/current/human-input/channels/email/resend"),
        ("PUT", "/console/api/workspaces/current/human-input/channels/email/resend"),
        ("DELETE", "/console/api/workspaces/current/human-input/channels/email/resend"),
        ("POST", "/console/api/workspaces/current/human-input/channels/email/resend/test"),
    ],
)
def test_enterprise_channel_routes_are_rejected_before_dispatch(
    monkeypatch: pytest.MonkeyPatch,
    method: str,
    path: str,
) -> None:
    monkeypatch.setattr(
        _CONTROLLER_MODULE,
        "dify_config",
        SimpleNamespace(DEPLOYMENT_EDITION=DeploymentEdition.ENTERPRISE),
    )
    monkeypatch.setattr(
        _CONTROLLER_MODULE,
        "build_human_input_channel_management_service",
        lambda: (_ for _ in ()).throw(AssertionError("channel service must not be built")),
    )
    app = Flask(__name__)
    app.register_blueprint(console_bp)

    response = app.test_client().open(path, method=method)

    assert response.status_code == 501
    assert response.json == {
        "code": "not_implemented",
        "message": "Human Input channel management is not implemented for Enterprise deployments.",
        "status": 501,
    }


def _resend_view(*, configured: bool = False) -> ChannelView:
    ref = ChannelRef(ChannelKind.EMAIL, ChannelProvider.RESEND)
    summary = ResendChannelSummary(
        NormalizedEmail("sender@example.com") if configured else None,
        "Sender" if configured else None,
        configured,
    )
    return ChannelView(
        ref=ref,
        scope=ChannelScope(ChannelScopeKind.WORKSPACE, "workspace-1"),
        configured=configured,
        status=ChannelStatus.CONFIGURED if configured else ChannelStatus.NOT_CONFIGURED,
        capabilities=frozenset((ChannelCapability.CONFIGURE, ChannelCapability.TEST)),
        summary=summary,
    )


def test_collection_uses_trusted_context_and_preserves_product_order(
    app: Flask,
    monkeypatch,
) -> None:
    refs = (
        ChannelRef(ChannelKind.EMAIL, ChannelProvider.RESEND),
        ChannelRef(ChannelKind.IM, ChannelProvider.SLACK),
        ChannelRef(ChannelKind.IM, ChannelProvider.FEISHU),
        ChannelRef(ChannelKind.IM, ChannelProvider.DING_TALK),
    )

    class Service:
        def list_channels(self, context):
            assert context is _CONTEXT
            return ChannelCollectionResult(
                (_resend_view(),),
                tuple(
                    (
                        ref,
                        ChannelFailure(
                            ChannelFailureCategory.UNSUPPORTED_OPERATION,
                            "im_channel_management_not_implemented",
                        ),
                    )
                    for ref in refs
                    if ref.kind is ChannelKind.IM
                ),
            )

    monkeypatch.setattr(_CONTROLLER_MODULE, "build_human_input_channel_management_context", lambda **_kwargs: _CONTEXT)
    monkeypatch.setattr(_CONTROLLER_MODULE, "build_human_input_channel_management_service", Service)
    api = WorkspaceHumanInputChannelsApi()
    handler = unwrap(api.get)

    with app.test_request_context(method="GET"):
        payload = handler(
            api,
            "workspace-1",
            SimpleNamespace(id="account-1", email="operator@example.com"),
        )

    assert [item["provider"] for item in payload["channels"]] == ["resend"]
    assert [item["provider"] for item in payload["failures"]] == ["slack", "feishu", "ding_talk"]


def test_save_rejects_route_candidate_mismatch_before_service_work(
    app: Flask,
    monkeypatch,
) -> None:
    monkeypatch.setattr(
        _CONTROLLER_MODULE,
        "build_human_input_channel_management_service",
        lambda: (_ for _ in ()).throw(AssertionError("service must not be built")),
    )
    api = WorkspaceHumanInputChannelApi()
    handler = unwrap(api.put)

    with app.test_request_context(
        method="PUT",
        json={
            "candidate": {
                "provider": "feishu",
                "app_id": "app",
                "app_secret": "secret",
            }
        },
    ):
        payload, status = handler(
            api,
            "workspace-1",
            SimpleNamespace(id="account-1", email="operator@example.com"),
            "im",
            "slack",
        )

    assert status == 400
    assert payload == {
        "error": {
            "category": "validation_failure",
            "code": "channel_candidate_mismatch",
        }
    }


def test_resend_save_dispatches_and_returns_safe_configured_view(
    app: Flask,
    monkeypatch,
) -> None:
    class Service:
        def save_channel(self, context, command):
            assert context is _CONTEXT
            assert command.ref == ChannelRef(ChannelKind.EMAIL, ChannelProvider.RESEND)
            assert command.candidate.api_key.value == "re_secret"
            return ChannelOperationResult.success(_resend_view(configured=True))

    monkeypatch.setattr(_CONTROLLER_MODULE, "build_human_input_channel_management_context", lambda **_kwargs: _CONTEXT)
    monkeypatch.setattr(_CONTROLLER_MODULE, "build_human_input_channel_management_service", Service)
    api = WorkspaceHumanInputChannelApi()
    handler = unwrap(api.put)

    with app.test_request_context(
        method="PUT",
        json={
            "candidate": {
                "provider": "resend",
                "sender_email": "sender@example.com",
                "sender_name": "Sender",
                "api_key": "re_secret",
            }
        },
    ):
        payload = handler(
            api,
            "workspace-1",
            SimpleNamespace(id="account-1", email="operator@example.com"),
            "email",
            "resend",
        )

    assert payload["configured"] is True
    assert payload["summary"]["api_key_configured"] is True
    assert "re_secret" not in repr(payload)


def test_resend_test_dispatches_and_returns_candidate_result(
    app: Flask,
    monkeypatch,
) -> None:
    checked_at = datetime(2026, 7, 31, 10)

    class Service:
        def test_channel(self, context, command):
            assert context is _CONTEXT
            assert command.ref == ChannelRef(ChannelKind.EMAIL, ChannelProvider.RESEND)
            return ChannelOperationResult.tested(
                ChannelTestResult(
                    ref=command.ref,
                    scope=ChannelScope(ChannelScopeKind.WORKSPACE, "workspace-1"),
                    status=ChannelStatus.CONNECTED,
                    summary=ResendChannelTestSummary(
                        recipient_email=context.actor_email,
                        sender_email=command.candidate.sender_email,
                        sender_name=command.candidate.sender_name,
                    ),
                    checked_at=checked_at,
                )
            )

    monkeypatch.setattr(_CONTROLLER_MODULE, "build_human_input_channel_management_context", lambda **_kwargs: _CONTEXT)
    monkeypatch.setattr(_CONTROLLER_MODULE, "build_human_input_channel_management_service", Service)
    api = WorkspaceHumanInputChannelTestApi()
    handler = unwrap(api.post)

    with app.test_request_context(
        method="POST",
        json={
            "candidate": {
                "provider": "resend",
                "sender_email": "sender@example.com",
                "sender_name": "Sender",
                "api_key": "re_secret",
            }
        },
    ):
        payload = handler(
            api,
            "workspace-1",
            SimpleNamespace(id="account-1", email="operator@example.com"),
            "email",
            "resend",
        )

    assert payload["status"] == "connected"
    assert payload["summary"] == {
        "provider": "resend",
        "recipient_email": "operator@example.com",
        "sender_email": "sender@example.com",
        "sender_name": "Sender",
    }
    assert "re_secret" not in repr(payload)


@pytest.mark.parametrize(
    ("api", "method"),
    [
        (WorkspaceHumanInputChannelApi(), "put"),
        (WorkspaceHumanInputChannelTestApi(), "post"),
    ],
)
@pytest.mark.parametrize(
    ("body", "content_type"),
    [
        ("{", "application/json"),
        ("{}", "text/plain"),
    ],
)
def test_invalid_json_transport_returns_stable_validation_failure(
    app: Flask,
    monkeypatch: pytest.MonkeyPatch,
    api,
    method: str,
    body: str,
    content_type: str,
) -> None:
    monkeypatch.setattr(
        _CONTROLLER_MODULE,
        "build_human_input_channel_management_service",
        lambda: (_ for _ in ()).throw(AssertionError("service must not be built")),
    )
    handler = unwrap(getattr(api, method))

    with app.test_request_context(method=method.upper(), data=body, content_type=content_type):
        payload, status = handler(
            api,
            "workspace-1",
            SimpleNamespace(id="account-1", email="operator@example.com"),
            "email",
            "resend",
        )

    assert status == 400
    assert payload == {
        "error": {
            "category": "validation_failure",
            "code": "invalid_request",
        }
    }


def test_im_candidate_test_returns_explicit_unimplemented_response(
    app: Flask,
    monkeypatch,
) -> None:
    class Service:
        def test_channel(self, context, command):
            assert context is _CONTEXT
            assert command.ref.provider is ChannelProvider.SLACK
            return ChannelOperationResult.failed(
                ChannelFailureCategory.UNSUPPORTED_OPERATION,
                "im_channel_management_not_implemented",
            )

    monkeypatch.setattr(_CONTROLLER_MODULE, "build_human_input_channel_management_context", lambda **_kwargs: _CONTEXT)
    monkeypatch.setattr(_CONTROLLER_MODULE, "build_human_input_channel_management_service", Service)
    api = WorkspaceHumanInputChannelTestApi()
    handler = unwrap(api.post)

    with app.test_request_context(
        method="POST",
        json={
            "candidate": {
                "provider": "slack",
                "client_id": "client",
                "client_secret": "secret",
                "signing_secret": "signing",
                "bot_token": "token",
                "app_token": "app-token",
            }
        },
    ):
        payload, status = handler(
            api,
            "workspace-1",
            SimpleNamespace(id="account-1", email="operator@example.com"),
            "im",
            "slack",
        )

    assert status == 405
    assert payload == {
        "error": {
            "category": "unsupported_operation",
            "code": "im_channel_management_not_implemented",
        }
    }


def test_unexpected_channel_failure_has_stable_safe_response(
    app: Flask,
    monkeypatch,
) -> None:
    monkeypatch.setattr(
        _CONTROLLER_MODULE,
        "build_human_input_channel_management_context",
        lambda **_kwargs: (_ for _ in ()).throw(RuntimeError("provider-secret")),
    )
    api = WorkspaceHumanInputChannelApi()
    handler = unwrap(api.get)

    with app.test_request_context(method="GET"):
        payload, status = handler(
            api,
            "workspace-1",
            SimpleNamespace(id="account-1", email="operator@example.com"),
            "im",
            "slack",
        )

    assert status == 500
    assert payload == {
        "error": {
            "category": "channel_failure",
            "code": "channel_management_failure",
        }
    }
    assert "provider-secret" not in repr(payload)
