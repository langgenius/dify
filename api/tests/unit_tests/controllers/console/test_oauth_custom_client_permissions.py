from inspect import unwrap
from types import FunctionType

import pytest

from controllers.common.rbac import RBACPermission, Workspace
from controllers.console.datasets.rag_pipeline.datasource_auth import DatasourceAuthOauthCustomClient
from controllers.console.workspace.tool_providers import ToolOAuthCustomClient
from tests.unit_tests.controllers.rbac_introspection import rbac_checks


@pytest.mark.parametrize(
    ("method", "legacy_gate"),
    [
        (ToolOAuthCustomClient.delete, "is_admin_or_owner_required"),
        (DatasourceAuthOauthCustomClient.delete, "edit_permission_required"),
    ],
)
def test_custom_oauth_client_delete_requires_management_permission(method: FunctionType, legacy_gate: str) -> None:
    legacy_wrapper = unwrap(method, stop=lambda wrapper: legacy_gate in wrapper.__code__.co_qualname)
    assert legacy_gate in legacy_wrapper.__code__.co_qualname

    # Both routes pass resource_required=False, so their bundle resolves to a Workspace
    # locator regardless of the resource_type they declared (see _single_check).
    [check] = rbac_checks(method)
    assert check.scene == RBACPermission.CREDENTIAL_MANAGE
    assert isinstance(check.locator, Workspace)
