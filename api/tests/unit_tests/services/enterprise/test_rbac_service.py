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
                    "role_key": "workspace.owner",
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
        assert out.data[0].role_key == "workspace.owner"

    def test_list_omits_params_when_default(self, mock_send: MagicMock):
        mock_send.return_value = {"data": [], "pagination": None}
        svc.RBACService.Roles.list("tenant-1")
        assert _call_args(mock_send).params is None

    def test_get_passes_id_query_param(self, mock_send: MagicMock):
        mock_send.return_value = {
            "id": "role-1",
            "type": "workspace",
            "role_key": "workspace.owner",
            "name": "Owner",
        }
        svc.RBACService.Roles.get("tenant-1", "acct-1", "role-1")
        call = _call_args(mock_send)
        assert call.method == "GET"
        assert call.endpoint == "/rbac/roles/item"
        assert call.params == {"id": "role-1"}

    def test_create_sends_body(self, mock_send: MagicMock):
        mock_send.return_value = {
            "id": "role-1",
            "type": "workspace",
            "role_key": "workspace.owner",
            "name": "Owner",
        }
        payload = svc.RoleMutation(
            name="Owner",
            role_key="workspace.owner",
            description="full access",
            permission_keys=["workspace.member.manage"],
        )
        svc.RBACService.Roles.create("tenant-1", "acct-1", payload)

        call = _call_args(mock_send)
        assert call.method == "POST"
        assert call.endpoint == "/rbac/roles"
        assert call.json == {
            "name": "Owner",
            "role_key": "workspace.owner",
            "description": "full access",
            "permission_keys": ["workspace.member.manage"],
            "type": "workspace",
        }

    def test_update_sends_id_param_and_body(self, mock_send: MagicMock):
        mock_send.return_value = {
            "id": "role-1",
            "type": "workspace",
            "role_key": "workspace.owner",
            "name": "Owner",
        }
        payload = svc.RoleMutation(name="Owner", role_key="workspace.owner", permission_keys=["x"])
        svc.RBACService.Roles.update("tenant-1", "acct-1", "role-1", payload)

        call = _call_args(mock_send)
        assert call.method == "PUT"
        assert call.endpoint == "/rbac/roles/item"
        assert call.params == {"id": "role-1"}
        assert call.json["role_key"] == "workspace.owner"

    def test_delete_uses_delete_method(self, mock_send: MagicMock):
        mock_send.return_value = {"message": "success"}
        svc.RBACService.Roles.delete("tenant-1", None, "role-1")

        call = _call_args(mock_send)
        assert call.method == "DELETE"
        assert call.endpoint == "/rbac/roles/item"
        assert call.params == {"id": "role-1"}
        assert call.account_id is None


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

    def test_app_replace_role_bindings(self, mock_send: MagicMock):
        mock_send.return_value = {"data": []}
        payload = svc.ReplaceRoleBindings(role_keys=["workspace.owner"])
        svc.RBACService.AppAccess.replace_role_bindings("tenant-1", "acct-1", "app-1", "policy-1", payload)
        call = _call_args(mock_send)
        assert call.method == "PUT"
        assert call.endpoint == "/rbac/apps/access-policy/role-bindings"
        assert call.params == {"app_id": "app-1", "policy_id": "policy-1"}
        assert call.json == {"role_keys": ["workspace.owner"]}

    def test_dataset_replace_member_bindings(self, mock_send: MagicMock):
        mock_send.return_value = {"data": []}
        payload = svc.ReplaceMemberBindings(account_ids=["acct-2"])
        svc.RBACService.DatasetAccess.replace_member_bindings(
            "tenant-1", "acct-1", "ds-1", "policy-1", payload
        )
        call = _call_args(mock_send)
        assert call.method == "PUT"
        assert call.endpoint == "/rbac/datasets/access-policy/member-bindings"
        assert call.params == {"dataset_id": "ds-1", "policy_id": "policy-1"}
        assert call.json == {"account_ids": ["acct-2"]}


class TestWorkspaceAccess:
    def test_app_matrix(self, mock_send: MagicMock):
        mock_send.return_value = {"items": []}
        svc.RBACService.WorkspaceAccess.app_matrix("tenant-1")
        call = _call_args(mock_send)
        assert call.method == "GET"
        assert call.endpoint == "/rbac/workspace/apps/access-policy"
        assert call.params is None

    def test_dataset_matrix(self, mock_send: MagicMock):
        mock_send.return_value = {"items": []}
        svc.RBACService.WorkspaceAccess.dataset_matrix("tenant-1")
        call = _call_args(mock_send)
        assert call.method == "GET"
        assert call.endpoint == "/rbac/workspace/datasets/access-policy"
        assert call.params is None

    def test_dataset_replace_role_bindings(self, mock_send: MagicMock):
        mock_send.return_value = {"data": []}
        payload = svc.ReplaceRoleBindings(role_keys=["workspace.editor"])
        svc.RBACService.WorkspaceAccess.replace_dataset_role_bindings(
            "tenant-1", "acct-1", "policy-1", payload
        )
        call = _call_args(mock_send)
        assert call.method == "PUT"
        assert call.endpoint == "/rbac/workspace/datasets/access-policy/role-bindings"
        assert call.params == {"policy_id": "policy-1"}
        assert call.json == {"role_keys": ["workspace.editor"]}


class TestMemberRoles:
    def test_get(self, mock_send: MagicMock):
        mock_send.return_value = {
            "account_id": "acct-2",
            "roles": [
                {
                    "id": "role-1",
                    "type": "workspace",
                    "role_key": "workspace.member",
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
        assert out.roles[0].role_key == "workspace.member"

    def test_replace(self, mock_send: MagicMock):
        mock_send.return_value = {"account_id": "acct-2", "roles": []}
        svc.RBACService.MemberRoles.replace(
            "tenant-1", "acct-1", "acct-2", role_keys=["workspace.owner", "workspace.editor"]
        )
        call = _call_args(mock_send)
        assert call.method == "PUT"
        assert call.endpoint == "/rbac/members/rbac-roles"
        assert call.params == {"account_id": "acct-2"}
        assert call.json == {"role_keys": ["workspace.owner", "workspace.editor"]}


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
