"""Model configuration routes retain admin and workspace RBAC admission."""

from collections.abc import Callable, Sequence
from inspect import unwrap
from types import SimpleNamespace
from unittest.mock import create_autospec

import pytest
from flask import Flask
from werkzeug.exceptions import Forbidden

from controllers.common.rbac import RBACCheck, RBACPermission, Workspace
from controllers.console import flask_admission
from controllers.console.workspace import models as controller
from enums.account import TenantAccountRole
from libs.login import AccountWithTenant
from services.model_load_balancing_application_service import ModelLoadBalancingApplicationService
from tests.unit_tests.config_override import apply_config_overrides
from tests.unit_tests.model_factories import make_account

METHODS = [controller.ModelProviderModelApi.post, controller.ModelProviderModelCredentialApi.get]


def _admission(method: Callable[..., object]) -> Callable[..., object]:
    return unwrap(method, stop=lambda view: "inject_request_context" in view.__code__.co_qualname)


@pytest.mark.parametrize("method", METHODS)
@pytest.mark.parametrize(
    "role", [TenantAccountRole.NORMAL, TenantAccountRole.EDITOR, TenantAccountRole.DATASET_OPERATOR]
)
def test_non_admins_cannot_read_or_configure_credentials(
    app: Flask,
    monkeypatch: pytest.MonkeyPatch,
    method: Callable[..., object],
    role: TenantAccountRole,
) -> None:
    apply_config_overrides(monkeypatch, RBAC_ENABLED=False)
    account = make_account(role=role)
    monkeypatch.setattr(flask_admission, "current_account_with_tenant", lambda: AccountWithTenant(account, "workspace"))
    with app.test_request_context(), pytest.raises(Forbidden):
        _admission(method)(None, provider="openai")


@pytest.mark.parametrize(
    ("method", "permission"),
    [
        (controller.ModelProviderModelApi.post, RBACPermission.PLUGIN_PREFERENCES),
        (controller.ModelProviderModelCredentialApi.get, RBACPermission.CREDENTIAL_MANAGE),
    ],
)
def test_rbac_admission_enforces_the_original_workspace_permission(
    app: Flask,
    monkeypatch: pytest.MonkeyPatch,
    method: Callable[..., object],
    permission: RBACPermission,
) -> None:
    apply_config_overrides(monkeypatch, RBAC_ENABLED=True)
    account = make_account(role=TenantAccountRole.NORMAL)
    monkeypatch.setattr(flask_admission, "current_account_with_tenant", lambda: AccountWithTenant(account, "workspace"))
    checked: list[bool] = []

    def denied(*, tenant_id: str, account_id: str, checks: Sequence[RBACCheck], path_args: dict[str, object]) -> None:
        assert (tenant_id, account_id) == ("workspace", account.id)
        assert path_args == {"provider": "openai"}
        assert len(checks) == 1
        assert checks[0].scene == permission
        assert isinstance(checks[0].locator, Workspace)
        checked.append(True)
        raise Forbidden

    monkeypatch.setattr(flask_admission, "enforce_rbac_checks", denied)
    with app.test_request_context(), pytest.raises(Forbidden):
        _admission(method)(None, provider="openai")
    assert checked == [True]


@pytest.mark.parametrize("rbac_enabled", [False, True])
@pytest.mark.parametrize("role", [TenantAccountRole.OWNER, TenantAccountRole.ADMIN])
def test_model_update_reaches_the_injected_service_after_admission(
    app: Flask,
    monkeypatch: pytest.MonkeyPatch,
    rbac_enabled: bool,
    role: TenantAccountRole,
) -> None:
    apply_config_overrides(monkeypatch, RBAC_ENABLED=rbac_enabled)
    account = make_account(role=role)
    monkeypatch.setattr(flask_admission, "current_account_with_tenant", lambda: AccountWithTenant(account, "workspace"))
    monkeypatch.setattr(flask_admission, "enforce_rbac_checks", lambda **_kwargs: None)
    service = create_autospec(ModelLoadBalancingApplicationService, instance=True)
    monkeypatch.setattr(controller, "application_services", lambda: SimpleNamespace(model_load_balancing=service))
    with app.test_request_context(
        method="POST",
        json={
            "model": "gpt-4",
            "model_type": "llm",
            "load_balancing": {"configs": [{"name": "credential"}], "enabled": True},
        },
    ):
        assert _admission(controller.ModelProviderModelApi.post)(None, provider="openai") == (
            {"result": "success"},
            200,
        )
    context = service.update_configs.call_args.args[0]
    assert context.account_id == account.id
    assert context.active_workspace_id == "workspace"
