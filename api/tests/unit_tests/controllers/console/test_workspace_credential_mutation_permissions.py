from inspect import getclosurevars, unwrap
from types import FunctionType

import pytest

from controllers.common.wraps import RBACPermission, RBACResourceScope
from controllers.console.datasets.data_source import DataSourceApi
from controllers.console.workspace.tool_providers import ToolBuiltinProviderAddApi


@pytest.mark.parametrize(
    ("method", "permission"),
    [
        (ToolBuiltinProviderAddApi.post, RBACPermission.CREDENTIAL_CREATE),
        (DataSourceApi.patch, RBACPermission.CREDENTIAL_MANAGE),
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
