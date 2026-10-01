"""Contract tests for the generated app / dataset / agent access-permission routes.

``controllers.console.workspace.rbac`` builds the same twelve endpoints for every
resource kind from ``_RESOURCE_ACCESS_ROUTES``. These tests pin the two things the
generation must not get wrong: the registered URLs (with their class names and HTTP
methods) and which inner-API client each handler reaches for.
"""

from __future__ import annotations

import inspect
from collections.abc import Callable

import pytest
from flask import Flask
from sqlalchemy.orm import Session, sessionmaker

from controllers.console import console_ns
from controllers.console.workspace.rbac import resources as rbac_mod
from enums import DeploymentEdition
from machinery.context import RequestContext
from services.rbac import contracts as rbac_contracts
from tests.unit_tests.rbac_fakes import Initialization, RBACDomain, build_rbac_domain

RESOURCE_ID = {
    rbac_contracts.RBACResourceType.APP: "app-1",
    rbac_contracts.RBACResourceType.DATASET: "dataset-1",
    rbac_contracts.RBACResourceType.AGENT: "agent-1",
}

# The URL segment and path parameter of each resource kind, spelled out here instead of read
# back from the same enum the controller builds its URLs from, so a rename fails this test.
RESOURCE_URL_PARTS = {
    rbac_contracts.RBACResourceType.APP: ("apps", "app_id"),
    rbac_contracts.RBACResourceType.DATASET: ("datasets", "dataset_id"),
    rbac_contracts.RBACResourceType.AGENT: ("agents", "agent_id"),
}


def _segment(spec: rbac_mod._ResourceAccessRoutes) -> str:
    return RESOURCE_URL_PARTS[spec.resource_type][0]


def _id_param(spec: rbac_mod._ResourceAccessRoutes) -> str:
    return RESOURCE_URL_PARTS[spec.resource_type][1]


@pytest.fixture
def app() -> Flask:
    flask_app = Flask(__name__)
    flask_app.config["TESTING"] = True
    return flask_app


@pytest.fixture(autouse=True)
def _rbac_config(config_overrides: Callable[..., None]) -> None:
    config_overrides(
        DEPLOYMENT_EDITION=DeploymentEdition.ENTERPRISE,
        RBAC_ENABLED=True,
        LOGIN_DISABLED=True,
    )


@pytest.fixture(params=rbac_mod._RESOURCE_ACCESS_ROUTES, ids=lambda spec: spec.resource_type.value)
def spec(request: pytest.FixtureRequest) -> rbac_mod._ResourceAccessRoutes:
    return request.param


@pytest.fixture
def apis(spec: rbac_mod._ResourceAccessRoutes) -> rbac_mod._ResourceAccessApis:
    return rbac_mod._RESOURCE_ACCESS_APIS[spec.resource_type]


@pytest.fixture
def resource_id(spec: rbac_mod._ResourceAccessRoutes) -> str:
    return RESOURCE_ID[spec.resource_type]


def _expected_routes(spec: rbac_mod._ResourceAccessRoutes) -> dict[str, tuple[str, set[str]]]:
    resource = f"/workspaces/current/rbac/{_segment(spec)}/<uuid:{_id_param(spec)}>"
    workspace = f"/workspaces/current/rbac/workspace/{_segment(spec)}"
    prefix = spec.class_prefix
    return {
        f"/workspaces/current/rbac/role-permissions/catalog/{spec.resource_type.value}": (
            f"RBAC{prefix}CatalogApi",
            {"GET"},
        ),
        f"{resource}/access-policy": (f"RBAC{prefix}MatrixApi", {"GET"}),
        f"{resource}/whitelist": (f"RBAC{prefix}WhitelistApi", {"GET", "PUT"}),
        f"{resource}/whitelist_config": (f"RBAC{prefix}WhitelistConfigApi", {"GET"}),
        f"{resource}/user-access-policies": (f"RBAC{prefix}UserAccessPoliciesApi", {"GET"}),
        f"{resource}/users/<uuid:target_account_id>/access-policies": (
            f"RBAC{prefix}UserAccessPolicyAssignmentApi",
            {"PUT"},
        ),
        f"{resource}/access-policies/<uuid:policy_id>/role-bindings": (f"RBAC{prefix}RoleBindingsApi", {"GET"}),
        f"{resource}/access-policies/<string:policy_id>/member-bindings": (
            f"RBAC{prefix}MemberBindingsApi",
            {"GET", "DELETE"},
        ),
        f"{workspace}/access-policy": (f"RBACWorkspace{prefix}MatrixApi", {"GET"}),
        f"{workspace}/access-policies/<uuid:policy_id>/role-bindings": (
            f"RBACWorkspace{prefix}RoleBindingsApi",
            {"GET"},
        ),
        f"{workspace}/access-policies/<uuid:policy_id>/bindings": (f"RBACWorkspace{prefix}BindingsApi", {"PUT"}),
        f"{workspace}/access-policies/<uuid:policy_id>/member-bindings": (
            f"RBACWorkspace{prefix}MemberBindingsApi",
            {"GET"},
        ),
    }


def _registered_resource_by_url() -> dict[str, type]:
    registered: dict[str, type] = {}
    for route in console_ns.resources:
        for url in route.urls:
            registered[url] = route.resource
    return registered


def test_every_resource_kind_registers_the_same_twelve_routes(spec: rbac_mod._ResourceAccessRoutes) -> None:
    registered = _registered_resource_by_url()

    for url, (class_name, methods) in _expected_routes(spec).items():
        assert url in registered, f"{url} is not registered"
        resource = registered[url]
        assert resource.__name__ == class_name
        assert set(resource.methods or ()) == methods


@pytest.fixture
def domain(sqlite_session_factory: sessionmaker[Session], monkeypatch: pytest.MonkeyPatch) -> RBACDomain:
    domain = build_rbac_domain(sqlite_session_factory, monkeypatch)
    monkeypatch.setattr(rbac_mod, "application_services", lambda: domain)
    return domain


def test_resource_route_forwards_context_kind_and_language(
    app: Flask,
    apis: rbac_mod._ResourceAccessApis,
    spec: rbac_mod._ResourceAccessRoutes,
    resource_id: str,
    domain: RBACDomain,
) -> None:
    domain.transport.response = {"items": []}
    context = RequestContext("request", "trace", "actor", "tenant")
    with app.test_request_context("/?language=ja"):
        result = inspect.unwrap(vars(apis.matrix)["get"])(apis.matrix(), context, **{_id_param(spec): resource_id})
    assert result["items"] == []
    sent = domain.transport.only_request
    assert (sent.tenant_id, sent.account_id) == ("tenant", "actor")
    assert sent.endpoint == f"/rbac/{_segment(spec)}/access-policy"
    assert sent.params == {_id_param(spec): resource_id, "language": "ja"}


def test_resource_whitelist_parses_body_and_returns_response(
    app: Flask,
    apis: rbac_mod._ResourceAccessApis,
    spec: rbac_mod._ResourceAccessRoutes,
    resource_id: str,
    domain: RBACDomain,
) -> None:
    domain.transport.response = {"account_ids": ["member"]}
    context = RequestContext("request", "trace", "actor", "tenant")
    with app.test_request_context("/", method="PUT", json={"automatic_include_workspace_members": True}):
        result = inspect.unwrap(vars(apis.whitelist)["put"])(
            apis.whitelist(), context, **{_id_param(spec): resource_id}
        )
    assert result == {"account_ids": ["member"]}
    assert domain.transport.only_request.json == {"automatic_include_workspace_members": True}
    assert domain.tasks.queued == [Initialization("tenant", "actor", {_id_param(spec): resource_id})]
