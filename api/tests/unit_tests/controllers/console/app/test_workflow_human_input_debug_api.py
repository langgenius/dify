from __future__ import annotations

from dataclasses import dataclass
from types import SimpleNamespace
from unittest.mock import MagicMock

import pytest
from flask import Flask
from pydantic import ValidationError

from controllers.console import wraps as console_wraps
from controllers.console.app import workflow as workflow_module
from controllers.console.app import wraps as app_wraps
from libs import login as login_lib
from models.account import Account, AccountStatus, TenantAccountRole
from models.model import AppMode


def _make_account() -> Account:
    account = Account(name="tester", email="tester@example.com")
    account.status = AccountStatus.ACTIVE
    account.role = TenantAccountRole.OWNER
    account.id = "account-123"  # type: ignore[assignment]
    account._current_tenant = SimpleNamespace(id="tenant-123")  # type: ignore[attr-defined]
    account._get_current_object = lambda: account  # type: ignore[attr-defined]
    return account


def _make_app(mode: AppMode) -> SimpleNamespace:
    return SimpleNamespace(id="app-123", tenant_id="tenant-123", mode=mode.value)


def _patch_console_guards(monkeypatch: pytest.MonkeyPatch, account: Account, app_model: SimpleNamespace) -> None:
    # Skip setup and auth guardrails
    monkeypatch.setattr("configs.dify_config.EDITION", "CLOUD")
    monkeypatch.setattr(login_lib.dify_config, "LOGIN_DISABLED", True)
    monkeypatch.setattr(login_lib, "current_user", account)
    monkeypatch.setattr(login_lib, "current_account_with_tenant", lambda: (account, account.current_tenant_id))
    monkeypatch.setattr(login_lib, "check_csrf_token", lambda *_, **__: None)
    monkeypatch.setattr(console_wraps, "current_account_with_tenant", lambda: (account, account.current_tenant_id))
    monkeypatch.setattr(app_wraps, "current_account_with_tenant", lambda: (account, account.current_tenant_id))
    monkeypatch.setattr(workflow_module, "current_account_with_tenant", lambda: (account, account.current_tenant_id))
    monkeypatch.setattr(console_wraps.dify_config, "EDITION", "CLOUD")
    monkeypatch.delenv("INIT_PASSWORD", raising=False)

    # Avoid hitting the database when resolving the app model
    monkeypatch.setattr(app_wraps, "_load_app_model", lambda _app_id: app_model)


@dataclass
class PreviewCase:
    resource_cls: type
    path: str
    mode: AppMode


@pytest.mark.parametrize(
    "case",
    [
        PreviewCase(
            resource_cls=workflow_module.AdvancedChatDraftHumanInputFormPreviewApi,
            path="/console/api/apps/app-123/advanced-chat/workflows/draft/human-input/nodes/node-42/form/preview",
            mode=AppMode.ADVANCED_CHAT,
        ),
        PreviewCase(
            resource_cls=workflow_module.WorkflowDraftHumanInputFormPreviewApi,
            path="/console/api/apps/app-123/workflows/draft/human-input/nodes/node-42/form/preview",
            mode=AppMode.WORKFLOW,
        ),
    ],
)
def test_human_input_preview_delegates_to_service(
    app: Flask, monkeypatch: pytest.MonkeyPatch, case: PreviewCase
) -> None:
    account = _make_account()
    app_model = _make_app(case.mode)
    _patch_console_guards(monkeypatch, account, app_model)

    preview_payload = {
        "form_id": "node-42",
        "form_content": "<div>example</div>",
        "inputs": [{"name": "topic"}],
        "actions": [{"id": "continue"}],
    }
    service_instance = MagicMock()
    service_instance.get_human_input_form_preview.return_value = preview_payload
    monkeypatch.setattr(workflow_module, "WorkflowService", MagicMock(return_value=service_instance))

    with app.test_request_context(case.path, method="POST", json={"inputs": {"topic": "tech"}}):
        response = case.resource_cls().post(app_id=app_model.id, node_id="node-42")

    assert response == preview_payload
    service_instance.get_human_input_form_preview.assert_called_once_with(
        app_model=app_model,
        account=account,
        node_id="node-42",
        inputs={"topic": "tech"},
    )


@dataclass
class SubmitCase:
    resource_cls: type
    path: str
    mode: AppMode


@pytest.mark.parametrize(
    "case",
    [
        SubmitCase(
            resource_cls=workflow_module.AdvancedChatDraftHumanInputFormRunApi,
            path="/console/api/apps/app-123/advanced-chat/workflows/draft/human-input/nodes/node-99/form/run",
            mode=AppMode.ADVANCED_CHAT,
        ),
        SubmitCase(
            resource_cls=workflow_module.WorkflowDraftHumanInputFormRunApi,
            path="/console/api/apps/app-123/workflows/draft/human-input/nodes/node-99/form/run",
            mode=AppMode.WORKFLOW,
        ),
    ],
)
def test_human_input_submit_forwards_payload(app: Flask, monkeypatch: pytest.MonkeyPatch, case: SubmitCase) -> None:
    account = _make_account()
    app_model = _make_app(case.mode)
    _patch_console_guards(monkeypatch, account, app_model)

    result_payload = {"node_id": "node-99", "outputs": {"__rendered_content": "<p>done</p>"}, "action": "approve"}
    service_instance = MagicMock()
    service_instance.submit_human_input_form_preview.return_value = result_payload
    monkeypatch.setattr(workflow_module, "WorkflowService", MagicMock(return_value=service_instance))

    with app.test_request_context(
        case.path,
        method="POST",
        json={"form_inputs": {"answer": "42"}, "inputs": {"#node-1.result#": "LLM output"}, "action": "approve"},
    ):
        response = case.resource_cls().post(app_id=app_model.id, node_id="node-99")

    assert response == result_payload
    service_instance.submit_human_input_form_preview.assert_called_once_with(
        app_model=app_model,
        account=account,
        node_id="node-99",
        form_inputs={"answer": "42"},
        inputs={"#node-1.result#": "LLM output"},
        action="approve",
    )


@dataclass
class DeliveryTestCase:
    resource_cls: type
    path: str
    mode: AppMode


@pytest.mark.parametrize(
    "case",
    [
        DeliveryTestCase(
            resource_cls=workflow_module.WorkflowDraftHumanInputDeliveryTestApi,
            path="/console/api/apps/app-123/workflows/draft/human-input/nodes/node-7/delivery-test",
            mode=AppMode.ADVANCED_CHAT,
        ),
        DeliveryTestCase(
            resource_cls=workflow_module.WorkflowDraftHumanInputDeliveryTestApi,
            path="/console/api/apps/app-123/workflows/draft/human-input/nodes/node-7/delivery-test",
            mode=AppMode.WORKFLOW,
        ),
    ],
)
def test_human_input_delivery_test_calls_service(
    app: Flask, monkeypatch: pytest.MonkeyPatch, case: DeliveryTestCase
) -> None:
    account = _make_account()
    app_model = _make_app(case.mode)
    _patch_console_guards(monkeypatch, account, app_model)

    service_instance = MagicMock()
    monkeypatch.setattr(workflow_module, "WorkflowService", MagicMock(return_value=service_instance))

    with app.test_request_context(
        case.path,
        method="POST",
        json={"delivery_method_id": "delivery-123"},
    ):
        response = case.resource_cls().post(app_id=app_model.id, node_id="node-7")

    assert response == {}
    service_instance.test_human_input_delivery.assert_called_once_with(
        app_model=app_model,
        account=account,
        node_id="node-7",
        delivery_method_id="delivery-123",
        inputs={},
    )


def test_human_input_delivery_test_maps_validation_error(app: Flask, monkeypatch: pytest.MonkeyPatch) -> None:
    account = _make_account()
    app_model = _make_app(AppMode.ADVANCED_CHAT)
    _patch_console_guards(monkeypatch, account, app_model)

    service_instance = MagicMock()
    service_instance.test_human_input_delivery.side_effect = ValueError("bad delivery method")
    monkeypatch.setattr(workflow_module, "WorkflowService", MagicMock(return_value=service_instance))

    with app.test_request_context(
        "/console/api/apps/app-123/workflows/draft/human-input/nodes/node-1/delivery-test",
        method="POST",
        json={"delivery_method_id": "bad"},
    ):
        with pytest.raises(ValueError):
            workflow_module.WorkflowDraftHumanInputDeliveryTestApi().post(app_id=app_model.id, node_id="node-1")


def test_human_input_preview_rejects_non_mapping(app: Flask, monkeypatch: pytest.MonkeyPatch) -> None:
    account = _make_account()
    app_model = _make_app(AppMode.ADVANCED_CHAT)
    _patch_console_guards(monkeypatch, account, app_model)

    with app.test_request_context(
        "/console/api/apps/app-123/advanced-chat/workflows/draft/human-input/nodes/node-1/form/preview",
        method="POST",
        json={"inputs": ["not-a-dict"]},
    ):
        with pytest.raises(ValidationError):
            workflow_module.AdvancedChatDraftHumanInputFormPreviewApi().post(app_id=app_model.id, node_id="node-1")
