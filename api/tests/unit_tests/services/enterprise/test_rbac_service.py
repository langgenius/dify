"""Unit tests for services.enterprise.rbac_service.

The enterprise RBAC client is almost pure glue: each method turns a single
``EnterpriseRequest.send_inner_rbac_request`` call into a pydantic response
model. Rather than spinning up an HTTP server we monkeypatch that helper and
assert on the arguments it received; that catches both routing regressions
(wrong method / wrong path / wrong params) and model-shape regressions in
one place.
"""

from __future__ import annotations

from types import SimpleNamespace
from unittest.mock import MagicMock, patch

import pytest

from services.enterprise import rbac_service as svc

MODULE = "services.enterprise.rbac_service"


@pytest.fixture
def mock_send():
    with patch(f"{MODULE}.EnterpriseRequest.send_inner_rbac_request") as send:
        yield send


def _call_args(send: MagicMock) -> SimpleNamespace:
    """Return the most recent (method, endpoint, kwargs) sent to the mock."""
    send.assert_called_once()
    args, kwargs = send.call_args
    return SimpleNamespace(method=args[0], endpoint=args[1], **kwargs)


class TestCatalog:
    def test_workspace_catalog(self, mock_send: MagicMock):
        mock_send.return_value = {"groups": [{"group_key": "workspace", "group_name": "工作空间", "permissions": []}]}

        out = svc.RBACService.Catalog.workspace("tenant-1", account_id="acct-1")

        call = _call_args(mock_send)
        assert call.method == "GET"
        assert call.endpoint == "/rbac/role-permissions/catalog"
        assert call.tenant_id == "tenant-1"
        assert call.account_id == "acct-1"
        assert call.json is None
        assert call.params is None
        assert len(out.groups) == 1
        assert out.groups[0].group_key == "workspace"

    def test_app_catalog_endpoint(self, mock_send: MagicMock):
        mock_send.return_value = {"groups": []}
        svc.RBACService.Catalog.app("tenant-1")
        assert mock_send.call_args.args[1] == "/rbac/role-permissions/catalog/app"

    def test_dataset_catalog_endpoint(self, mock_send: MagicMock):
        mock_send.return_value = {"groups": []}
        svc.RBACService.Catalog.dataset("tenant-1")
        assert mock_send.call_args.args[1] == "/rbac/role-permissions/catalog/dataset"


class TestRoles:
    def test_list_forwards_pagination_options(self, mock_send: MagicMock):
        mock_send.return_value = {
            "data": [
                {
                    "id": "role-1",
                    "tenant_id": "tenant-1",
                    "type": "workspace",
                    "category": "global_custom",
                    "name": "Owner",
                    "permission_keys": ["workspace.member.manage"],
                }
            ],
            "pagination": {"total_count": 1, "per_page": 20, "current_page": 1, "total_pages": 1},
        }

        out = svc.RBACService.Roles.list(
            "tenant-1",
            "acct-1",
            options=svc.ListOption(page_number=2, results_per_page=50, reverse=True),
        )

        call = _call_args(mock_send)
        assert call.method == "GET"
        assert call.endpoint == "/rbac/roles"
        assert call.params == {"page_number": 2, "results_per_page": 50, "reverse": "true"}
        assert out.pagination and out.pagination.total_count == 1

    def test_list_omits_params_when_default(self, mock_send: MagicMock):
        mock_send.return_value = {"data": [], "pagination": None}
        svc.RBACService.Roles.list("tenant-1")
        assert _call_args(mock_send).params is None

    def test_list_coerces_null_permission_keys(self, mock_send: MagicMock):
        mock_send.return_value = {
            "data": [
                {
                    "id": "role-1",
                    "tenant_id": "tenant-1",
                    "type": "workspace",
                    "category": "global_custom",
                    "name": "Owner",
                    "permission_keys": None,
                }
            ],
            "pagination": None,
        }

        out = svc.RBACService.Roles.list("tenant-1")

        assert out.data[0].permission_keys == []

    def test_get_passes_id_query_param(self, mock_send: MagicMock):
        mock_send.return_value = {"id": "role-1", "type": "workspace", "name": "Owner"}
        svc.RBACService.Roles.get("tenant-1", "acct-1", "role-1")
        call = _call_args(mock_send)
        assert call.method == "GET"
        assert call.endpoint == "/rbac/roles/item"
        assert call.params == {"id": "role-1"}

    def test_create_sends_body(self, mock_send: MagicMock):
        mock_send.return_value = {"id": "role-1", "type": "workspace", "name": "Owner"}
        payload = svc.RoleMutation(name="Owner", description="full access", permission_keys=["workspace.member.manage"])
        svc.RBACService.Roles.create("tenant-1", "acct-1", payload)

        call = _call_args(mock_send)
        assert call.method == "POST"
        assert call.endpoint == "/rbac/roles"
        assert call.json == {
            "name": "Owner",
            "description": "full access",
            "permission_keys": ["workspace.member.manage"],
            "type": "workspace",
        }

    def test_update_sends_id_param_and_body(self, mock_send: MagicMock):
        mock_send.return_value = {"id": "role-1", "type": "workspace", "name": "Owner"}
        payload = svc.RoleMutation(name="Owner", permission_keys=["x"])
        svc.RBACService.Roles.update("tenant-1", "acct-1", "role-1", payload)

        call = _call_args(mock_send)
        assert call.method == "PUT"
        assert call.endpoint == "/rbac/roles/item"
        assert call.params == {"id": "role-1"}
        assert call.json == {"name": "Owner", "description": "", "permission_keys": ["x"], "type": "workspace"}

    def test_delete_uses_delete_method(self, mock_send: MagicMock):
        mock_send.return_value = {"message": "success"}
        svc.RBACService.Roles.delete("tenant-1", None, "role-1")

        call = _call_args(mock_send)
        assert call.method == "DELETE"
        assert call.endpoint == "/rbac/roles/item"
        assert call.params == {"id": "role-1"}
        assert call.account_id is None

    def test_copy_sends_post_with_id_param(self, mock_send: MagicMock):
        mock_send.return_value = {"id": "role-1-copy", "type": "workspace", "name": "Owner copy"}
        svc.RBACService.Roles.copy("tenant-1", "acct-1", "role-1")

        call = _call_args(mock_send)
        assert call.method == "POST"
        assert call.endpoint == "/rbac/roles/copy"
        assert call.params == {"id": "role-1"}
        assert call.account_id == "acct-1"


class TestAccessPolicies:
    def test_list_filters_by_resource_type(self, mock_send: MagicMock):
        mock_send.return_value = {"data": [], "pagination": None}
        svc.RBACService.AccessPolicies.list(
            "tenant-1",
            "acct-1",
            resource_type=svc.RBACResourceType.APP,
            options=svc.ListOption(page_number=1),
        )
        call = _call_args(mock_send)
        assert call.endpoint == "/rbac/access-policies"
        assert call.params == {"page_number": 1, "resource_type": "app"}

    def test_copy_sends_post_with_id_param(self, mock_send: MagicMock):
        mock_send.return_value = {
            "id": "policy-1-copy",
            "resource_type": "app",
            "name": "Full access copy",
        }
        svc.RBACService.AccessPolicies.copy("tenant-1", "acct-1", "policy-1")
        call = _call_args(mock_send)
        assert call.method == "POST"
        assert call.endpoint == "/rbac/access-policies/copy"
        assert call.params == {"id": "policy-1"}

    def test_create_serialises_resource_type_enum(self, mock_send: MagicMock):
        mock_send.return_value = {"id": "policy-1", "resource_type": "dataset", "name": "KB only"}
        payload = svc.AccessPolicyCreate(
            name="KB only",
            resource_type=svc.RBACResourceType.DATASET,
            permission_keys=["dataset.acl.readonly"],
        )
        svc.RBACService.AccessPolicies.create("tenant-1", "acct-1", payload)
        call = _call_args(mock_send)
        assert call.method == "POST"
        assert call.json == {
            "name": "KB only",
            "resource_type": "dataset",
            "description": "",
            "permission_keys": ["dataset.acl.readonly"],
        }


class TestResourceAccess:
    def test_app_matrix(self, mock_send: MagicMock):
        mock_send.return_value = {"app_id": "app-1", "items": []}
        out = svc.RBACService.AppAccess.matrix("tenant-1", "acct-1", "app-1")
        call = _call_args(mock_send)
        assert call.method == "GET"
        assert call.endpoint == "/rbac/apps/access-policy"
        assert call.params == {"app_id": "app-1"}
        assert out.app_id == "app-1"

    def test_app_role_bindings_preserve_role_name(self, mock_send: MagicMock):
        mock_send.return_value = {
            "data": [
                {
                    "id": "binding-1",
                    "tenant_id": "tenant-1",
                    "access_policy_id": "policy-1",
                    "resource_type": "app",
                    "resource_id": "app-1",
                    "role_id": "role-1",
                    "role_name": "Owner",
                }
            ]
        }

        out = svc.RBACService.AppAccess.list_role_bindings("tenant-1", "acct-1", "app-1", "policy-1")

        assert out.data[0].role_name == "Owner"

    def test_app_member_bindings_preserve_account_name(self, mock_send: MagicMock):
        mock_send.return_value = {
            "data": [
                {
                    "id": "binding-1",
                    "tenant_id": "tenant-1",
                    "access_policy_id": "policy-1",
                    "resource_type": "app",
                    "resource_id": "app-1",
                    "account_id": "acct-1",
                    "account_name": "Alice",
                }
            ]
        }

        out = svc.RBACService.AppAccess.list_member_bindings("tenant-1", "acct-1", "app-1", "policy-1")

        assert out.data[0].account_name == "Alice"

    def test_app_replace_bindings(self, mock_send: MagicMock):
        mock_send.return_value = {"data": []}
        payload = svc.ReplaceBindings(role_ids=["workspace.owner"], account_ids=["acct-2"])
        svc.RBACService.AppAccess.replace_bindings("tenant-1", "acct-1", "app-1", "policy-1", payload)
        call = _call_args(mock_send)
        assert call.method == "PUT"
        assert call.endpoint == "/rbac/apps/access-policy/bindings"
        assert call.params == {"app_id": "app-1", "policy_id": "policy-1"}
        assert call.json == {"role_ids": ["workspace.owner"], "account_ids": ["acct-2"]}

    def test_dataset_replace_bindings(self, mock_send: MagicMock):
        mock_send.return_value = {"data": []}
        payload = svc.ReplaceBindings(role_ids=["workspace.editor"], account_ids=["acct-2"])
        svc.RBACService.DatasetAccess.replace_bindings("tenant-1", "acct-1", "ds-1", "policy-1", payload)
        call = _call_args(mock_send)
        assert call.method == "PUT"
        assert call.endpoint == "/rbac/datasets/access-policy/bindings"
        assert call.params == {"dataset_id": "ds-1", "policy_id": "policy-1"}
        assert call.json == {"role_ids": ["workspace.editor"], "account_ids": ["acct-2"]}


class TestWorkspaceAccess:
    def test_app_matrix(self, mock_send: MagicMock):
        mock_send.return_value = {"items": [], "pagination": {"total_count": 1, "per_page": 20, "current_page": 2, "total_pages": 1}}
        out = svc.RBACService.WorkspaceAccess.app_matrix(
            "tenant-1",
            options=svc.ListOption(page_number=2, results_per_page=20),
        )
        call = _call_args(mock_send)
        assert call.method == "GET"
        assert call.endpoint == "/rbac/workspace/apps/access-policy"
        assert call.params == {"page_number": 2, "results_per_page": 20}
        assert out.pagination and out.pagination.current_page == 2

    def test_dataset_matrix(self, mock_send: MagicMock):
        mock_send.return_value = {"items": []}
        svc.RBACService.WorkspaceAccess.dataset_matrix("tenant-1")
        call = _call_args(mock_send)
        assert call.method == "GET"
        assert call.endpoint == "/rbac/workspace/datasets/access-policy"
        assert call.params is None

    def test_workspace_matrix_coerces_null_bindings(self, mock_send: MagicMock):
        mock_send.return_value = {
            "items": [
                {
                    "policy": {
                        "id": "policy-1",
                        "resource_type": "app",
                        "name": "Workspace App Access",
                    },
                    "roles": None,
                    "accounts": None,
                }
            ],
            "pagination": None,
        }

        out = svc.RBACService.WorkspaceAccess.app_matrix("tenant-1")

        assert out.items[0].roles == []
        assert out.items[0].accounts == []

    def test_workspace_app_replace_bindings(self, mock_send: MagicMock):
        mock_send.return_value = {"data": []}
        payload = svc.ReplaceBindings(role_ids=["workspace.editor"], account_ids=["acct-2"])
        svc.RBACService.WorkspaceAccess.replace_app_bindings(
            "tenant-1", "acct-1", "policy-1", payload
        )
        call = _call_args(mock_send)
        assert call.method == "PUT"
        assert call.endpoint == "/rbac/workspace/apps/access-policy/bindings"
        assert call.params == {"policy_id": "policy-1"}
        assert call.json == {"role_ids": ["workspace.editor"], "account_ids": ["acct-2"]}

    def test_workspace_dataset_replace_bindings(self, mock_send: MagicMock):
        mock_send.return_value = {"data": []}
        payload = svc.ReplaceBindings(role_ids=["workspace.editor"], account_ids=["acct-2"])
        svc.RBACService.WorkspaceAccess.replace_dataset_bindings(
            "tenant-1", "acct-1", "policy-1", payload
        )
        call = _call_args(mock_send)
        assert call.method == "PUT"
        assert call.endpoint == "/rbac/workspace/datasets/access-policy/bindings"
        assert call.params == {"policy_id": "policy-1"}
        assert call.json == {"role_ids": ["workspace.editor"], "account_ids": ["acct-2"]}


class TestMyPermissions:
    def test_get_without_payload_uses_get(self, mock_send: MagicMock):
        mock_send.return_value = {
            "workspace": {"permission_keys": ["workspace.member.manage"]},
            "app": {"default_permission_keys": ["app.acl.view_layout", "app.acl.test_and_run"], "overrides": []},
            "dataset": {"default_permission_keys": [], "overrides": []},
        }

        with patch(f"{MODULE}.dify_config.RBAC_ENABLED", True):
            out = svc.RBACService.MyPermissions.get("tenant-1", "acct-1")

        call = _call_args(mock_send)
        assert call.method == "GET"
        assert call.endpoint == "/rbac/my-permissions"
        assert call.json is None
        assert call.params is None
        assert out.workspace.permission_keys == ["workspace.member.manage"]

    @pytest.mark.parametrize(
        ("role", "workspace_keys", "app_keys", "dataset_keys"),
        [
            (
                "owner",
                svc._LEGACY_WORKSPACE_OWNER_KEYS,
                svc._LEGACY_APP_OWNER_KEYS,
                svc._LEGACY_DATASET_OWNER_KEYS,
            ),
            (
                "admin",
                svc._LEGACY_WORKSPACE_ADMIN_KEYS,
                svc._LEGACY_APP_ADMIN_KEYS,
                svc._LEGACY_DATASET_ADMIN_KEYS,
            ),
            (
                "editor",
                svc._LEGACY_WORKSPACE_EDITOR_KEYS,
                svc._LEGACY_APP_EDITOR_KEYS,
                svc._LEGACY_DATASET_EDITOR_KEYS,
            ),
            (
                "normal",
                svc._LEGACY_WORKSPACE_NORMAL_KEYS,
                svc._LEGACY_APP_NORMAL_KEYS,
                [],
            ),
            (
                "dataset_operator",
                svc._LEGACY_WORKSPACE_DATASET_OPERATOR_KEYS,
                [],
                svc._LEGACY_DATASET_DATASET_OPERATOR_KEYS,
            ),
        ],
    )
    def test_get_uses_legacy_role_permissions_when_rbac_disabled(
        self,
        mock_send: MagicMock,
        role: str,
        workspace_keys: list[str],
        app_keys: list[str],
        dataset_keys: list[str],
    ):
        mock_session = MagicMock()
        mock_session.__enter__.return_value = mock_session
        mock_session.scalar.return_value = role
        with (
            patch(f"{MODULE}.dify_config.RBAC_ENABLED", False),
            patch(f"{MODULE}.session_factory.create_session", return_value=mock_session),
        ):
            out = svc.RBACService.MyPermissions.get("tenant-1", "acct-1")

        mock_send.assert_not_called()
        assert out.workspace.permission_keys == workspace_keys
        assert out.app.default_permission_keys == app_keys
        assert out.dataset.default_permission_keys == dataset_keys
        assert out.app.overrides == []
        assert out.dataset.overrides == []

    def test_get_returns_empty_when_role_missing_and_rbac_disabled(self, mock_send: MagicMock):
        mock_session = MagicMock()
        mock_session.__enter__.return_value = mock_session
        mock_session.scalar.return_value = None
        with (
            patch(f"{MODULE}.dify_config.RBAC_ENABLED", False),
            patch(f"{MODULE}.session_factory.create_session", return_value=mock_session),
        ):
            out = svc.RBACService.MyPermissions.get("tenant-1", "acct-1")

        mock_send.assert_not_called()
        assert out.workspace.permission_keys == []
        assert out.app.default_permission_keys == []
        assert out.dataset.default_permission_keys == []

    def test_get_with_single_resource_filters(self, mock_send: MagicMock):
        mock_send.return_value = {
            "workspace": {"permission_keys": []},
            "app": {"default_permission_keys": [], "overrides": [{"resource_id": "app-1", "permission_keys": ["app.acl.edit"]}]},
            "dataset": {"default_permission_keys": [], "overrides": []},
        }

        with patch(f"{MODULE}.dify_config.RBAC_ENABLED", True):
            out = svc.RBACService.MyPermissions.get("tenant-1", "acct-1", app_id="app-1")

        call = _call_args(mock_send)
        assert call.method == "GET"
        assert call.endpoint == "/rbac/my-permissions"
        assert call.params == {"app_id": "app-1"}
        assert out.app.overrides[0].resource_id == "app-1"


class TestMemberRoles:
    def test_get(self, mock_send: MagicMock):
        mock_send.return_value = {
            "account_id": "acct-2",
            "roles": [
                {
                    "id": "role-1",
                    "type": "workspace",
                    "name": "Member",
                }
            ],
        }
        out = svc.RBACService.MemberRoles.get("tenant-1", "acct-1", "acct-2")
        call = _call_args(mock_send)
        assert call.method == "GET"
        assert call.endpoint == "/rbac/members/rbac-roles"
        assert call.params == {"account_id": "acct-2"}
        assert out.account_id == "acct-2"
        assert out.roles[0].name == "Member"

    def test_replace(self, mock_send: MagicMock):
        mock_send.return_value = {"account_id": "acct-2", "roles": []}
        svc.RBACService.MemberRoles.replace(
            "tenant-1", "acct-1", "acct-2", role_ids=["workspace.owner", "workspace.editor"]
        )
        call = _call_args(mock_send)
        assert call.method == "PUT"
        assert call.endpoint == "/rbac/members/rbac-roles"
        assert call.params == {"account_id": "acct-2"}
        assert call.json == {"role_ids": ["workspace.owner", "workspace.editor"]}

    def test_batch_get(self, mock_send: MagicMock):
        mock_send.return_value = {
            "acct-2": [
                {"id": "role-1", "name": "Admin"},
                {"id": "role-2", "name": "Editor"},
            ],
            "acct-3": [],
        }

        out = svc.RBACService.MemberRoles.batch_get("tenant-1", "acct-1", ["acct-2", "acct-3"])

        call = _call_args(mock_send)
        assert call.method == "POST"
        assert call.endpoint == "/rbac/members/rbac-roles/batch"
        assert call.json == {"member_ids": ["acct-2", "acct-3"]}
        assert out[0].account_id == "acct-2"
        assert len(out[0].roles) == 2
        assert out[1].account_id == "acct-3"
        assert out[1].roles == []


class TestResourcePermissions:
    def test_app_permissions_batch_get(self, mock_send: MagicMock):
        mock_send.return_value = {
            "data": [
                {"resource_id": "app-1", "permission_keys": ["app.acl.view_layout", "app.acl.edit"]},
                {"resource_id": "app-2", "permission_keys": []},
            ]
        }

        out = svc.RBACService.AppPermissions.batch_get("tenant-1", "acct-1", ["app-1", "app-2"])

        call = _call_args(mock_send)
        assert call.method == "POST"
        assert call.endpoint == "/rbac/apps/permission-keys/batch"
        assert call.json == {"app_ids": ["app-1", "app-2"]}
        assert out == {
            "app-1": ["app.acl.view_layout", "app.acl.edit"],
            "app-2": [],
        }

    def test_dataset_permissions_batch_get(self, mock_send: MagicMock):
        mock_send.return_value = {
            "data": [
                {"resource_id": "ds-1", "permission_keys": ["dataset.acl.readonly"]},
                {"resource_id": "ds-2", "permission_keys": ["dataset.acl.edit"]},
            ]
        }

        out = svc.RBACService.DatasetPermissions.batch_get("tenant-1", "acct-1", ["ds-1", "ds-2"])

        call = _call_args(mock_send)
        assert call.method == "POST"
        assert call.endpoint == "/rbac/datasets/permission-keys/batch"
        assert call.json == {"dataset_ids": ["ds-1", "ds-2"]}
        assert out == {
            "ds-1": ["dataset.acl.readonly"],
            "ds-2": ["dataset.acl.edit"],
        }


class TestListOption:
    def test_empty_produces_empty_params(self):
        assert svc.ListOption().to_params() == {}

    def test_reverse_serialises_as_lowercase_bool(self):
        assert svc.ListOption(reverse=False).to_params()["reverse"] == "false"
        assert svc.ListOption(reverse=True).to_params()["reverse"] == "true"

    def test_extra_overrides_merge(self):
        assert svc.ListOption(page_number=1).to_params({"resource_type": "app", "skip": None}) == {
            "page_number": 1,
            "resource_type": "app",
        }
