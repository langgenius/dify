"""Console model-usage lookup keeps workspace-manager admission and serializes the application records."""

import inspect
import json
from collections.abc import Callable

import pytest
from flask import Flask
from sqlalchemy.orm import Session, sessionmaker
from werkzeug.exceptions import Forbidden, UnprocessableEntity

from controllers.common.rbac import Workspace
from controllers.console import flask_admission
from controllers.console.workspace import model_usages
from controllers.console.workspace.model_usages import ModelProviderModelUsageApi
from core.rbac import RBACPermission
from extensions.ext_application_services import ApplicationServices
from libs.login import AccountWithTenant
from models.account import TenantAccountRole
from models.model import AppModelConfig
from services.enterprise.base import EnterpriseRequest
from tests.helpers.unit.config_override import apply_config_overrides
from tests.helpers.unit.controllers.rbac_introspection import rbac_checks
from tests.helpers.unit.model_factories import make_account, make_app
from tests.helpers.unit.rbac_fakes import RBACTransport

WORKSPACE_ID = "11111111-1111-4111-8111-111111111111"
APP_ID = "22222222-2222-4222-8222-222222222222"
HIDDEN_APP_ID = "22222222-2222-4222-8222-222222222223"
PROVIDER = "langgenius/openai/openai"


def _admission_injector(method: Callable[..., object]) -> Callable[..., object]:
    """Skip setup/login wrappers and enter at the admission adapter that builds the RequestContext."""
    return inspect.unwrap(method, stop=lambda view: "inject_request_context" in view.__code__.co_qualname)


def _admit(monkeypatch: pytest.MonkeyPatch, role: TenantAccountRole, *, rbac_enabled: bool = False) -> None:
    apply_config_overrides(monkeypatch, RBAC_ENABLED=rbac_enabled)
    identity = AccountWithTenant(account=make_account(account_id="account-1", role=role), tenant_id=WORKSPACE_ID)
    monkeypatch.setattr(flask_admission, "current_account_with_tenant", lambda: identity)


def test_declares_workspace_manager_admission_and_plugin_preferences_rbac() -> None:
    admission = _admission_injector(ModelProviderModelUsageApi.get)

    assert inspect.getclosurevars(admission).nonlocals["allowed_roles"] == frozenset(
        {TenantAccountRole.OWNER, TenantAccountRole.ADMIN}
    )
    [check] = rbac_checks(ModelProviderModelUsageApi.get)
    assert check.scene == RBACPermission.PLUGIN_PREFERENCES
    assert isinstance(check.locator, Workspace)


@pytest.mark.parametrize(
    "role", [TenantAccountRole.NORMAL, TenantAccountRole.EDITOR, TenantAccountRole.DATASET_OPERATOR]
)
def test_rejects_members_who_cannot_manage_models(monkeypatch: pytest.MonkeyPatch, role: TenantAccountRole) -> None:
    _admit(monkeypatch, role)

    with (
        Flask(__name__).test_request_context(query_string={"model": "gpt-4o"}),
        pytest.raises(Forbidden),
    ):
        _admission_injector(ModelProviderModelUsageApi.get)(None, provider=PROVIDER)


def _add_chat_apps(sqlite_session_factory: sessionmaker[Session], *app_ids: str) -> None:
    with sqlite_session_factory() as session:
        for app_id in app_ids:
            config = AppModelConfig(app_id=app_id, model=json.dumps({"provider": PROVIDER, "name": "gpt-4o"}))
            session.add(config)
            session.flush()
            session.add(
                make_app(app_id=app_id, tenant_id=WORKSPACE_ID, name="Support bot", app_model_config_id=config.id)
            )
        session.commit()


@pytest.mark.parametrize("role", [TenantAccountRole.OWNER, TenantAccountRole.ADMIN])
def test_lists_usages_of_the_current_workspace_for_managers(
    monkeypatch: pytest.MonkeyPatch,
    account_application_services: ApplicationServices,
    sqlite_session_factory: sessionmaker[Session],
    role: TenantAccountRole,
) -> None:
    _add_chat_apps(sqlite_session_factory, APP_ID)
    monkeypatch.setattr(model_usages, "application_services", lambda: account_application_services)
    _admit(monkeypatch, role)

    with Flask(__name__).test_request_context(query_string={"model": "gpt-4o", "model_type": "llm"}):
        response = _admission_injector(ModelProviderModelUsageApi.get)(None, provider=PROVIDER)

    assert response == {
        "data": [
            {
                "app_id": APP_ID,
                "app_name": "Support bot",
                "app_mode": "chat",
                "source": "app_model_config",
                "node_id": None,
                "node_title": None,
                "node_type": None,
            }
        ],
        "inaccessible_count": 0,
    }


@pytest.mark.parametrize("query", [{}, {"model": ""}, {"model": "gpt-4o", "model_type": "text-embedding"}])
def test_rejects_queries_outside_the_llm_lookup_contract(
    monkeypatch: pytest.MonkeyPatch, query: dict[str, str]
) -> None:
    _admit(monkeypatch, TenantAccountRole.OWNER)

    with (
        Flask(__name__).test_request_context(query_string=query),
        pytest.raises(UnprocessableEntity),
    ):
        _admission_injector(ModelProviderModelUsageApi.get)(None, provider=PROVIDER)


def test_under_rbac_lists_visible_apps_and_counts_the_others(
    monkeypatch: pytest.MonkeyPatch,
    account_application_services: ApplicationServices,
    sqlite_session_factory: sessionmaker[Session],
) -> None:
    _add_chat_apps(sqlite_session_factory, APP_ID, HIDDEN_APP_ID)
    monkeypatch.setattr(model_usages, "application_services", lambda: account_application_services)
    # A custom role: no built-in manager role, but granted plugin preferences and only APP_ID in its app whitelist.
    _admit(monkeypatch, TenantAccountRole.NORMAL, rbac_enabled=True)
    transport = RBACTransport(
        responses={
            "/rbac/check-access": {"allowed": True},
            "/rbac/my-permissions": {"workspace": {"permission_keys": ["plugin.plugin_preferences"]}},
            "/rbac/apps/whitelist/resources": {"unrestricted": False, "resource_ids": [APP_ID]},
        }
    )
    monkeypatch.setattr(EnterpriseRequest, "send_inner_rbac_request", transport.send)

    with Flask(__name__).test_request_context(query_string={"model": "gpt-4o"}):
        response = _admission_injector(ModelProviderModelUsageApi.get)(None, provider=PROVIDER)

    assert response == {
        "data": [
            {
                "app_id": APP_ID,
                "app_name": "Support bot",
                "app_mode": "chat",
                "source": "app_model_config",
                "node_id": None,
                "node_title": None,
                "node_type": None,
            }
        ],
        "inaccessible_count": 1,
    }
