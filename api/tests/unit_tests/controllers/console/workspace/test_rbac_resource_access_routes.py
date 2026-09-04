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

# The workspace-level client is one flat class, so its method names are spelled out per
# resource kind rather than derived from the spec under test.
WORKSPACE_ACCESS_METHODS = {
    svc.RBACResourceType.APP: {
        "matrix": "app_matrix",
        "role_bindings": "list_app_role_bindings",
        "member_bindings": "list_app_member_bindings",
        "replace_bindings": "replace_app_bindings",
    },
    svc.RBACResourceType.DATASET: {
        "matrix": "dataset_matrix",
        "role_bindings": "list_dataset_role_bindings",
        "member_bindings": "list_dataset_member_bindings",
        "replace_bindings": "replace_dataset_bindings",
    },
    svc.RBACResourceType.AGENT: {
        "matrix": "agent_matrix",
        "role_bindings": "list_agent_role_bindings",
        "member_bindings": "list_agent_member_bindings",
        "replace_bindings": "replace_agent_bindings",
    },
}

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

# Only app and dataset carry a maintainer column to pin to the top of the member list.
MAINTAINER_HELPER = {
    svc.RBACResourceType.APP: "app_maintainer_id",
    svc.RBACResourceType.DATASET: "dataset_maintainer_id",
    svc.RBACResourceType.AGENT: None,
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


def test_matrix_reads_the_resource_client(
    app: Flask, apis: rbac_mod._ResourceAccessApis, spec: rbac_mod._ResourceAccessRoutes, resource_id: str
) -> None:
    matrix = MagicMock(return_value=spec.matrix_model())
    with (
        app.test_request_context(f"/{_segment(spec)}/{resource_id}/access-policy"),
        patch.object(spec.access, "matrix", matrix),
    ):
        inspect.unwrap(apis.matrix.get)(apis.matrix(), **{_id_param(spec): resource_id})

    matrix.assert_called_once_with("tenant-1", "acct-actor", resource_id)


def test_whitelist_get_reads_the_resource_client(
    app: Flask, apis: rbac_mod._ResourceAccessApis, spec: rbac_mod._ResourceAccessRoutes, resource_id: str
) -> None:
    whitelist = MagicMock(return_value=svc.ResourceWhitelist())
    with (
        app.test_request_context(f"/{_segment(spec)}/{resource_id}/whitelist"),
        patch.object(spec.access, "whitelist", whitelist),
    ):
        inspect.unwrap(apis.whitelist.get)(apis.whitelist(), **{_id_param(spec): resource_id})

    whitelist.assert_called_once_with("tenant-1", "acct-actor", resource_id)


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


def test_whitelist_config_reads_the_resource_client(
    app: Flask, apis: rbac_mod._ResourceAccessApis, spec: rbac_mod._ResourceAccessRoutes, resource_id: str
) -> None:
    config = MagicMock(return_value=svc.ResourceWhitelistConfig(automatic_include_workspace_members=True))
    with (
        app.test_request_context(f"/{_segment(spec)}/{resource_id}/whitelist_config"),
        patch.object(spec.access, "whitelist_config", config),
    ):
        response = inspect.unwrap(apis.whitelist_config.get)(apis.whitelist_config(), **{_id_param(spec): resource_id})

    assert response == {"automatic_include_workspace_members": True}
    config.assert_called_once_with("tenant-1", "acct-actor", resource_id)


def test_user_access_policies_forwards_pagination(
    app: Flask, apis: rbac_mod._ResourceAccessApis, spec: rbac_mod._ResourceAccessRoutes, resource_id: str
) -> None:
    policies = MagicMock(return_value=svc.ResourceUserAccessPoliciesResponse())
    with (
        app.test_request_context(f"/{_segment(spec)}/{resource_id}/user-access-policies?page=2&limit=30&reverse=true"),
        patch.object(spec.access, "user_access_policies", policies),
        patch("controllers.console.workspace.rbac.svc.app_maintainer_id", return_value=None),
        patch("controllers.console.workspace.rbac.svc.dataset_maintainer_id", return_value=None),
    ):
        inspect.unwrap(apis.user_access_policies.get)(apis.user_access_policies(), **{_id_param(spec): resource_id})

    assert policies.call_args.args == ("tenant-1", "acct-actor", resource_id)
    options = policies.call_args.kwargs["options"]
    assert (options.page_number, options.results_per_page) == (2, 30)
    assert options.reverse is True


def test_user_access_policies_pins_the_maintainer_only_where_one_exists(
    app: Flask, apis: rbac_mod._ResourceAccessApis, spec: rbac_mod._ResourceAccessRoutes, resource_id: str
) -> None:
    policies = MagicMock(return_value=svc.ResourceUserAccessPoliciesResponse())
    helpers = {name: MagicMock(return_value=None) for name in ("app_maintainer_id", "dataset_maintainer_id")}
    with (
        app.test_request_context(f"/{_segment(spec)}/{resource_id}/user-access-policies"),
        patch.object(spec.access, "user_access_policies", policies),
        patch("controllers.console.workspace.rbac.svc.app_maintainer_id", helpers["app_maintainer_id"]),
        patch("controllers.console.workspace.rbac.svc.dataset_maintainer_id", helpers["dataset_maintainer_id"]),
    ):
        inspect.unwrap(apis.user_access_policies.get)(apis.user_access_policies(), **{_id_param(spec): resource_id})

    expected_helper = MAINTAINER_HELPER[spec.resource_type]
    for name, helper in helpers.items():
        if name == expected_helper:
            helper.assert_called_once_with("tenant-1", resource_id)
        else:
            helper.assert_not_called()


def test_user_access_policy_assignment_forwards_ids(
    app: Flask, apis: rbac_mod._ResourceAccessApis, spec: rbac_mod._ResourceAccessRoutes, resource_id: str
) -> None:
    replace = MagicMock(return_value=svc.ReplaceUserAccessPoliciesResponse())
    with (
        app.test_request_context(
            f"/{_segment(spec)}/{resource_id}/users/acct-target/access-policies",
            method="PUT",
            json={"access_policy_ids": ["policy-1", "policy-2"]},
        ),
        patch.object(spec.access, "replace_user_access_policies", replace),
    ):
        inspect.unwrap(apis.user_access_policy_assignment.put)(
            apis.user_access_policy_assignment(),
            target_account_id="acct-target",
            **{_id_param(spec): resource_id},
        )

    tenant_id, actor_id, target_id, target_account_id, payload = replace.call_args.args
    assert (tenant_id, actor_id, target_id, target_account_id) == (
        "tenant-1",
        "acct-actor",
        resource_id,
        "acct-target",
    )
    assert payload.access_policy_ids == ["policy-1", "policy-2"]


def test_role_bindings_reads_the_resource_client(
    app: Flask, apis: rbac_mod._ResourceAccessApis, spec: rbac_mod._ResourceAccessRoutes, resource_id: str
) -> None:
    bindings = MagicMock(return_value=svc.RoleBindingsResponse())
    with (
        app.test_request_context(f"/{_segment(spec)}/{resource_id}/access-policies/policy-1/role-bindings"),
        patch.object(spec.access, "list_role_bindings", bindings),
    ):
        inspect.unwrap(apis.role_bindings.get)(
            apis.role_bindings(), policy_id="policy-1", **{_id_param(spec): resource_id}
        )

    bindings.assert_called_once_with("tenant-1", "acct-actor", resource_id, "policy-1")


def test_member_bindings_get_reads_the_resource_client(
    app: Flask, apis: rbac_mod._ResourceAccessApis, spec: rbac_mod._ResourceAccessRoutes, resource_id: str
) -> None:
    bindings = MagicMock(return_value=svc.MemberBindingsResponse())
    with (
        app.test_request_context(f"/{_segment(spec)}/{resource_id}/access-policies/policy-1/member-bindings"),
        patch.object(spec.access, "list_member_bindings", bindings),
    ):
        inspect.unwrap(apis.member_bindings.get)(
            apis.member_bindings(), policy_id="policy-1", **{_id_param(spec): resource_id}
        )

    bindings.assert_called_once_with("tenant-1", "acct-actor", resource_id, "policy-1")


def test_member_bindings_delete_forwards_account_ids(
    app: Flask, apis: rbac_mod._ResourceAccessApis, spec: rbac_mod._ResourceAccessRoutes, resource_id: str
) -> None:
    delete = MagicMock()
    with (
        app.test_request_context(
            f"/{_segment(spec)}/{resource_id}/access-policies/policy-1/member-bindings",
            method="DELETE",
            json={"account_ids": ["acct-2", "acct-3"]},
        ),
        patch.object(spec.access, "delete_member_bindings", delete),
    ):
        response = inspect.unwrap(apis.member_bindings.delete)(
            apis.member_bindings(), policy_id="policy-1", **{_id_param(spec): resource_id}
        )

    assert response == {"result": "success"}
    tenant_id, actor_id, target_id, policy_id, payload = delete.call_args.args
    assert (tenant_id, actor_id, target_id, policy_id) == ("tenant-1", "acct-actor", resource_id, "policy-1")
    assert payload.account_ids == ["acct-2", "acct-3"]


def test_workspace_matrix_forwards_pagination(
    app: Flask, apis: rbac_mod._ResourceAccessApis, spec: rbac_mod._ResourceAccessRoutes
) -> None:
    matrix = MagicMock(return_value=svc.WorkspaceAccessMatrix())
    method_name = WORKSPACE_ACCESS_METHODS[spec.resource_type]["matrix"]
    with (
        app.test_request_context(f"/workspace/{_segment(spec)}/access-policy?page=4&limit=10&reverse=true"),
        patch.object(svc.RBACService.WorkspaceAccess, method_name, matrix),
    ):
        inspect.unwrap(apis.workspace_matrix.get)(apis.workspace_matrix())

    assert matrix.call_args.args == ("tenant-1", "acct-actor")
    options = matrix.call_args.kwargs["options"]
    assert (options.page_number, options.results_per_page) == (4, 10)
    assert options.reverse is True


def test_workspace_role_bindings_reads_the_workspace_client(
    app: Flask, apis: rbac_mod._ResourceAccessApis, spec: rbac_mod._ResourceAccessRoutes
) -> None:
    bindings = MagicMock(return_value=svc.RoleBindingsResponse())
    method_name = WORKSPACE_ACCESS_METHODS[spec.resource_type]["role_bindings"]
    with (
        app.test_request_context(f"/workspace/{_segment(spec)}/access-policies/policy-1/role-bindings"),
        patch.object(svc.RBACService.WorkspaceAccess, method_name, bindings),
    ):
        inspect.unwrap(apis.workspace_role_bindings.get)(apis.workspace_role_bindings(), "policy-1")

    bindings.assert_called_once_with("tenant-1", "acct-actor", "policy-1")


def test_workspace_member_bindings_reads_the_workspace_client(
    app: Flask, apis: rbac_mod._ResourceAccessApis, spec: rbac_mod._ResourceAccessRoutes
) -> None:
    bindings = MagicMock(return_value=svc.MemberBindingsResponse())
    method_name = WORKSPACE_ACCESS_METHODS[spec.resource_type]["member_bindings"]
    with (
        app.test_request_context(f"/workspace/{_segment(spec)}/access-policies/policy-1/member-bindings"),
        patch.object(svc.RBACService.WorkspaceAccess, method_name, bindings),
    ):
        inspect.unwrap(apis.workspace_member_bindings.get)(apis.workspace_member_bindings(), "policy-1")

    bindings.assert_called_once_with("tenant-1", "acct-actor", "policy-1")


def test_workspace_bindings_put_forwards_role_and_account_ids(
    app: Flask, apis: rbac_mod._ResourceAccessApis, spec: rbac_mod._ResourceAccessRoutes
) -> None:
    replace = MagicMock(return_value=svc.AccessMatrixItem())
    method_name = WORKSPACE_ACCESS_METHODS[spec.resource_type]["replace_bindings"]
    with (
        app.test_request_context(
            f"/workspace/{_segment(spec)}/access-policies/policy-1/bindings",
            method="PUT",
            json={"role_ids": ["role-1"], "account_ids": ["acct-2"]},
        ),
        patch.object(svc.RBACService.WorkspaceAccess, method_name, replace),
    ):
        inspect.unwrap(apis.workspace_bindings.put)(apis.workspace_bindings(), "policy-1")

    tenant_id, actor_id, policy_id, payload = replace.call_args.args
    assert (tenant_id, actor_id, policy_id) == ("tenant-1", "acct-actor", "policy-1")
    assert payload.role_ids == ["role-1"]
    assert payload.account_ids == ["acct-2"]


def test_catalog_reads_the_resource_catalog(
    apis: rbac_mod._ResourceAccessApis, spec: rbac_mod._ResourceAccessRoutes
) -> None:
    catalog = MagicMock(return_value=svc.PermissionCatalogResponse())
    with patch.object(svc.RBACService.Catalog, spec.resource_type.value, catalog):
        inspect.unwrap(apis.catalog.get)(apis.catalog())

    catalog.assert_called_once_with("tenant-1", "acct-actor")
