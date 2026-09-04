from inspect import unwrap
from types import FunctionType

import pytest

from controllers.common.rbac import AgentId, RBACPermission, Workspace
from controllers.console.agent.composer import AgentComposerApi
from controllers.console.agent.roster import AgentAppApi
from controllers.console.datasets.data_source import DataSourceApi
from controllers.console.datasets.rag_pipeline.datasource_auth import DatasourceAuth
from controllers.console.workspace.model_providers import ModelProviderCredentialApi
from controllers.console.workspace.tool_providers import ToolBuiltinProviderAddApi, ToolOAuthCustomClient
from tests.unit_tests.controllers.rbac_introspection import rbac_checks


@pytest.mark.parametrize(
    ("method", "permission"),
    [
        (ToolBuiltinProviderAddApi.post, RBACPermission.CREDENTIAL_CREATE),
        (DataSourceApi.patch, RBACPermission.CREDENTIAL_MANAGE),
        (DataSourceApi.get, RBACPermission.CREDENTIAL_MANAGE),
    ],
)
def test_workspace_credential_mutations_require_management_permission(
    method: FunctionType, permission: RBACPermission
) -> None:
    legacy_wrapper = unwrap(method, stop=lambda wrapper: "is_admin_or_owner_required" in wrapper.__code__.co_qualname)
    assert "is_admin_or_owner_required" in legacy_wrapper.__code__.co_qualname

    [check] = rbac_checks(method)
    assert check.scene == permission
    assert isinstance(check.locator, Workspace)


@pytest.mark.parametrize(
    "method",
    [
        ModelProviderCredentialApi.get,
    ],
)
def test_model_provider_credential_get_requires_admin_and_rbac(
    method: FunctionType,
) -> None:
    """GET endpoints that return provider credential details must enforce
    the same admin + RBAC gates as their sibling POST/PUT/DELETE methods."""
    legacy_wrapper = unwrap(method, stop=lambda wrapper: "is_admin_or_owner_required" in wrapper.__code__.co_qualname)
    assert "is_admin_or_owner_required" in legacy_wrapper.__code__.co_qualname

    [check] = rbac_checks(method)
    assert check.scene == RBACPermission.CREDENTIAL_MANAGE
    assert isinstance(check.locator, Workspace)


def test_tool_oauth_custom_client_get_requires_admin_and_rbac() -> None:
    """GET endpoint that returns custom OAuth client params must enforce
    the same admin + RBAC gates as its sibling POST and DELETE methods."""
    method = ToolOAuthCustomClient.get

    legacy_wrapper = unwrap(method, stop=lambda wrapper: "is_admin_or_owner_required" in wrapper.__code__.co_qualname)
    assert "is_admin_or_owner_required" in legacy_wrapper.__code__.co_qualname

    [check] = rbac_checks(method)
    assert check.scene == RBACPermission.CREDENTIAL_MANAGE
    assert isinstance(check.locator, Workspace)


def test_datasource_auth_get_requires_edit_and_rbac() -> None:
    """GET endpoint that lists datasource credentials must enforce
    the same edit + RBAC gates as its sibling POST method."""
    method = DatasourceAuth.get

    edit_wrapper = unwrap(method, stop=lambda wrapper: "edit_permission_required" in wrapper.__code__.co_qualname)
    assert "edit_permission_required" in edit_wrapper.__code__.co_qualname

    [check] = rbac_checks(method)
    assert check.scene == RBACPermission.CREDENTIAL_MANAGE
    assert isinstance(check.locator, Workspace)


@pytest.mark.parametrize(
    "method",
    [
        AgentAppApi.get,
        AgentComposerApi.get,
    ],
)
def test_agent_app_get_requires_rbac(method: FunctionType) -> None:
    """GET endpoints that return agent app details or composer state must require
    the agent preview scene on the agent resource, same as their sibling routes."""
    [check] = rbac_checks(method)
    assert check.scene == RBACPermission.AGENT_PREVIEW
    assert isinstance(check.locator, AgentId)
