from inspect import getclosurevars, unwrap
from types import FunctionType

import pytest

from controllers.common.wraps import RBACPermission, RBACResourceScope
from controllers.console.datasets.rag_pipeline.datasource_auth import DatasourceAuthOauthCustomClient
from controllers.console.workspace.tool_providers import ToolOAuthCustomClient


@pytest.mark.parametrize(
    ("method", "legacy_gate", "resource_type"),
    [
        (ToolOAuthCustomClient.delete, "is_admin_or_owner_required", RBACResourceScope.WORKSPACE),
        (DatasourceAuthOauthCustomClient.delete, "edit_permission_required", RBACResourceScope.DATASET),
    ],
)
def test_custom_oauth_client_delete_requires_management_permission(
    method: FunctionType, legacy_gate: str, resource_type: RBACResourceScope
) -> None:
    legacy_wrapper = unwrap(method, stop=lambda wrapper: legacy_gate in wrapper.__code__.co_qualname)
    assert legacy_gate in legacy_wrapper.__code__.co_qualname

    rbac_wrapper = unwrap(method, stop=lambda wrapper: "rbac_permission_required" in wrapper.__code__.co_qualname)
    rbac_config = getclosurevars(rbac_wrapper).nonlocals
    assert rbac_config["resource_type"] == resource_type
    assert rbac_config["scene"] == RBACPermission.CREDENTIAL_MANAGE
    assert rbac_config["resource_required"] is False
