"""The credential validation envelope and unconditional privileged-role gate."""

from inspect import unwrap
from types import SimpleNamespace
from unittest.mock import create_autospec

import pytest
from flask import Flask
from werkzeug.exceptions import Forbidden

from controllers.console.workspace import load_balancing_config as controller
from enums.account import TenantAccountRole
from graphon.model_runtime.entities.model_entities import ModelType
from graphon.model_runtime.errors.validate import CredentialsValidateFailedError
from libs.login import AccountWithTenant
from machinery.context import RequestContext
from services.model_load_balancing_application_service import ModelLoadBalancingApplicationService
from tests.unit_tests.config_override import apply_config_overrides
from tests.unit_tests.model_factories import make_account

CONTEXT = RequestContext("request", None, "account", "workspace")


@pytest.mark.parametrize("config_id", [None, "config"])
@pytest.mark.parametrize("failure", [None, "invalid credentials"])
def test_validation_response(
    app: Flask,
    monkeypatch: pytest.MonkeyPatch,
    config_id: str | None,
    failure: str | None,
) -> None:
    service = create_autospec(ModelLoadBalancingApplicationService, instance=True)
    if failure:
        service.validate_credentials.side_effect = CredentialsValidateFailedError(failure)
    monkeypatch.setattr(controller, "application_services", lambda: SimpleNamespace(model_load_balancing=service))
    account = make_account(role=TenantAccountRole.OWNER)
    monkeypatch.setattr(controller, "current_account_with_tenant", lambda: AccountWithTenant(account, "workspace"))
    payload = controller.LoadBalancingCredentialPayload(
        model="gpt-4",
        model_type=ModelType.LLM,
        credentials={"api_key": "secret"},
    )
    api = (
        controller.LoadBalancingCredentialsValidateApi()
        if config_id is None
        else controller.LoadBalancingConfigCredentialsValidateApi()
    )
    kwargs: dict[str, str] = {} if config_id is None else {"config_id": config_id}
    with app.test_request_context("/"):
        response = unwrap(api.post)(api, payload, CONTEXT, provider="openai", **kwargs)

    assert response == ({"result": "error", "error": failure} if failure else {"result": "success"})
    service.validate_credentials.assert_called_once_with(
        CONTEXT,
        provider="openai",
        model="gpt-4",
        model_type=ModelType.LLM,
        credentials={"api_key": "secret"},
        config_id=config_id,
    )


@pytest.mark.parametrize("config_id", [None, "config"])
@pytest.mark.parametrize("rbac_enabled", [False, True])
@pytest.mark.parametrize("role", list(TenantAccountRole))
def test_role_gate_is_independent_of_rbac(
    app: Flask,
    monkeypatch: pytest.MonkeyPatch,
    config_id: str | None,
    rbac_enabled: bool,
    role: TenantAccountRole,
) -> None:
    apply_config_overrides(monkeypatch, RBAC_ENABLED=rbac_enabled)
    service = create_autospec(ModelLoadBalancingApplicationService, instance=True)
    monkeypatch.setattr(controller, "application_services", lambda: SimpleNamespace(model_load_balancing=service))
    account = make_account(role=role)
    monkeypatch.setattr(controller, "current_account_with_tenant", lambda: AccountWithTenant(account, "workspace"))
    payload = controller.LoadBalancingCredentialPayload(model="gpt-4", model_type=ModelType.LLM, credentials={})
    api = (
        controller.LoadBalancingCredentialsValidateApi()
        if config_id is None
        else controller.LoadBalancingConfigCredentialsValidateApi()
    )
    kwargs: dict[str, str] = {} if config_id is None else {"config_id": config_id}
    with app.test_request_context("/"):
        if role in {TenantAccountRole.OWNER, TenantAccountRole.ADMIN}:
            assert unwrap(api.post)(api, payload, CONTEXT, provider="openai", **kwargs) == {"result": "success"}
        else:
            with pytest.raises(Forbidden):
                unwrap(api.post)(api, payload, CONTEXT, provider="openai", **kwargs)
            service.validate_credentials.assert_not_called()


def test_missing_config_stays_a_value_error(app: Flask, monkeypatch: pytest.MonkeyPatch) -> None:
    service = create_autospec(ModelLoadBalancingApplicationService, instance=True)
    service.validate_credentials.side_effect = ValueError("Load balancing config missing does not exist.")
    monkeypatch.setattr(controller, "application_services", lambda: SimpleNamespace(model_load_balancing=service))
    account = make_account(role=TenantAccountRole.ADMIN)
    monkeypatch.setattr(controller, "current_account_with_tenant", lambda: AccountWithTenant(account, "workspace"))
    api = controller.LoadBalancingConfigCredentialsValidateApi()
    payload = controller.LoadBalancingCredentialPayload(model="gpt-4", model_type=ModelType.LLM, credentials={})
    with app.test_request_context("/"), pytest.raises(ValueError, match="missing does not exist"):
        unwrap(api.post)(api, payload, CONTEXT, provider="openai", config_id="missing")
