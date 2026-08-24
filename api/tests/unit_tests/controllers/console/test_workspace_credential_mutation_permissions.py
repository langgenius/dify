from inspect import getclosurevars, unwrap
from types import FunctionType

import pytest

from controllers.common.wraps import RBACPermission, RBACResourceScope
from controllers.console.datasets.data_source import DataSourceApi
from controllers.console.datasets.rag_pipeline.datasource_auth import DatasourceAuth
from controllers.console.workspace.model_providers import ModelProviderCredentialApi
from controllers.console.workspace.models import DefaultModelApi, ModelProviderModelApi, ModelProviderModelCredentialApi
from controllers.console.workspace.tool_providers import ToolBuiltinProviderAddApi, ToolOAuthCustomClient


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

    rbac_wrapper = unwrap(method, stop=lambda wrapper: "rbac_permission_required" in wrapper.__code__.co_qualname)
    rbac_config = getclosurevars(rbac_wrapper).nonlocals
    assert rbac_config["resource_type"] == RBACResourceScope.WORKSPACE
    assert rbac_config["scene"] == permission
    assert rbac_config["resource_required"] is False


@pytest.mark.parametrize(
    "method",
    [
        ModelProviderCredentialApi.get,
        ModelProviderModelCredentialApi.get,
    ],
)
def test_model_provider_credential_get_requires_admin_and_rbac(
    method: FunctionType,
) -> None:
    """GET endpoints that return provider credential details must enforce
    the same admin + RBAC gates as their sibling POST/PUT/DELETE methods."""
    legacy_wrapper = unwrap(method, stop=lambda wrapper: "is_admin_or_owner_required" in wrapper.__code__.co_qualname)
    assert "is_admin_or_owner_required" in legacy_wrapper.__code__.co_qualname

    rbac_wrapper = unwrap(method, stop=lambda wrapper: "rbac_permission_required" in wrapper.__code__.co_qualname)
    rbac_config = getclosurevars(rbac_wrapper).nonlocals
    assert rbac_config["resource_type"] == RBACResourceScope.WORKSPACE
    assert rbac_config["scene"] == RBACPermission.CREDENTIAL_MANAGE
    assert rbac_config["resource_required"] is False


def test_tool_oauth_custom_client_get_requires_admin_and_rbac() -> None:
    """GET endpoint that returns custom OAuth client params must enforce
    the same admin + RBAC gates as its sibling POST and DELETE methods."""
    method = ToolOAuthCustomClient.get

    legacy_wrapper = unwrap(method, stop=lambda wrapper: "is_admin_or_owner_required" in wrapper.__code__.co_qualname)
    assert "is_admin_or_owner_required" in legacy_wrapper.__code__.co_qualname

    rbac_wrapper = unwrap(method, stop=lambda wrapper: "rbac_permission_required" in wrapper.__code__.co_qualname)
    rbac_config = getclosurevars(rbac_wrapper).nonlocals
    assert rbac_config["resource_type"] == RBACResourceScope.WORKSPACE
    assert rbac_config["scene"] == RBACPermission.CREDENTIAL_MANAGE
    assert rbac_config["resource_required"] is False


def test_datasource_auth_get_requires_edit_and_rbac() -> None:
    """GET endpoint that lists datasource credentials must enforce
    the same edit + RBAC gates as its sibling POST method."""
    method = DatasourceAuth.get

    edit_wrapper = unwrap(method, stop=lambda wrapper: "edit_permission_required" in wrapper.__code__.co_qualname)
    assert "edit_permission_required" in edit_wrapper.__code__.co_qualname

    rbac_wrapper = unwrap(method, stop=lambda wrapper: "rbac_permission_required" in wrapper.__code__.co_qualname)
    rbac_config = getclosurevars(rbac_wrapper).nonlocals
    assert rbac_config["resource_type"] == RBACResourceScope.DATASET
    assert rbac_config["scene"] == RBACPermission.CREDENTIAL_MANAGE
    assert rbac_config["resource_required"] is False


@pytest.mark.parametrize(
    "method",
    [
        DefaultModelApi.get,
        ModelProviderModelApi.get,
    ],
)
def test_workspace_model_preferences_get_require_admin_and_rbac(
    method: FunctionType,
) -> None:
    """GET endpoints that return workspace model preferences must enforce
    the same admin + RBAC gates as their sibling POST/DELETE methods."""
    legacy_wrapper = unwrap(method, stop=lambda wrapper: "is_admin_or_owner_required" in wrapper.__code__.co_qualname)
    assert "is_admin_or_owner_required" in legacy_wrapper.__code__.co_qualname

    rbac_wrapper = unwrap(method, stop=lambda wrapper: "rbac_permission_required" in wrapper.__code__.co_qualname)
    rbac_config = getclosurevars(rbac_wrapper).nonlocals
    assert rbac_config["resource_type"] == RBACResourceScope.WORKSPACE
    assert rbac_config["scene"] == RBACPermission.PLUGIN_PREFERENCES
    assert rbac_config["resource_required"] is False
