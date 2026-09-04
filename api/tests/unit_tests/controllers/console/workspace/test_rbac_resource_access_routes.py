"""Contract tests for the generated app / dataset / agent access-permission routes.

``controllers.console.workspace.rbac`` builds the same twelve endpoints for every
resource kind from ``_RESOURCE_ACCESS_ROUTES``. These tests pin the two things the
generation must not get wrong: the registered URLs (with their class names and HTTP
methods) and which inner-API client each handler reaches for.
"""

from __future__ import annotations

import inspect
from collections.abc import Callable, Generator
from unittest.mock import MagicMock, patch

import pytest
from flask import Flask

from controllers.console import console_ns
from controllers.console.workspace import rbac as rbac_mod
from enums import DeploymentEdition
from services.enterprise import rbac_service as svc

RESOURCE_ID = {
    svc.RBACResourceType.APP: "app-1",
    svc.RBACResourceType.DATASET: "dataset-1",
    svc.RBACResourceType.AGENT: "agent-1",
}

# The URL segment and path parameter of each resource kind, spelled out here instead of read
# back from the same enum the controller builds its URLs from, so a rename fails this test.
RESOURCE_URL_PARTS = {
    svc.RBACResourceType.APP: ("apps", "app_id"),
    svc.RBACResourceType.DATASET: ("datasets", "dataset_id"),
    svc.RBACResourceType.AGENT: ("agents", "agent_id"),
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


@pytest.fixture(autouse=True)
def _patched_current_ids() -> Generator[None]:
    with patch("controllers.console.workspace.rbac._current_ids", return_value=("tenant-1", "acct-actor")):
        yield


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


@pytest.mark.parametrize("automatic_include_workspace_members", [True, False])
def test_whitelist_put_queues_the_seed_task_only_when_auto_including(
    app: Flask,
    apis: rbac_mod._ResourceAccessApis,
    spec: rbac_mod._ResourceAccessRoutes,
    resource_id: str,
    automatic_include_workspace_members: bool,
) -> None:
    replace = MagicMock(
        return_value=svc.ResourceWhitelist(
            automatic_include_workspace_members=automatic_include_workspace_members,
        )
    )
    with (
        app.test_request_context(
            f"/{_segment(spec)}/{resource_id}/whitelist",
            method="PUT",
            json={"automatic_include_workspace_members": automatic_include_workspace_members},
        ),
        patch.object(spec.access, "replace_whitelist", replace),
        patch("controllers.console.workspace.rbac.initialize_created_app_rbac_access_task") as seed_task,
    ):
        inspect.unwrap(apis.whitelist.put)(apis.whitelist(), **{_id_param(spec): resource_id})

    tenant_id, actor_id, target_id, payload = replace.call_args.args
    assert (tenant_id, actor_id, target_id) == ("tenant-1", "acct-actor", resource_id)
    assert payload.automatic_include_workspace_members is automatic_include_workspace_members

    if automatic_include_workspace_members:
        seed_task.delay.assert_called_once_with("tenant-1", "acct-actor", **{_id_param(spec): resource_id})
    else:
        seed_task.delay.assert_not_called()
