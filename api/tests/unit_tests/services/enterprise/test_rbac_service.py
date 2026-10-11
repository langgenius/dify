"""Unit tests for services.enterprise.rbac_service.

Most enterprise RBAC methods turn a single ``EnterpriseRequest.send_inner_rbac_request``
call into a pydantic response model. Rather than spinning up an HTTP server, these tests
replace that helper and assert on the request arguments and response shape.
Local membership tests live at the application service boundary.
"""

from __future__ import annotations

from collections.abc import Callable

import pytest

from services.enterprise import rbac_service as svc
from services.enterprise.base import EnterpriseRequest
from services.rbac import contracts as rbac_contracts
from tests.unit_tests.rbac_fakes import RBACTransport, RecordedRequest


@pytest.fixture
def transport(monkeypatch: pytest.MonkeyPatch) -> RBACTransport:
    transport = RBACTransport()
    monkeypatch.setattr(EnterpriseRequest, "send_inner_rbac_request", transport.send)
    return transport


def _call_args(transport: RBACTransport) -> RecordedRequest:
    return transport.only_request


class TestCatalog:
    def test_workspace_catalog(self, transport: RBACTransport) -> None:
        transport.response = {"groups": [{"group_key": "workspace", "group_name": "工作空间", "permissions": []}]}

        out = svc.RBACService.Catalog.workspace("tenant-1", account_id="acct-1")

        call = _call_args(transport)
        assert call.method == "GET"
        assert call.endpoint == "/rbac/role-permissions/catalog"
        assert call.tenant_id == "tenant-1"
        assert call.account_id == "acct-1"
        assert call.json is None
        assert call.params is None
        assert len(out.groups) == 1
        assert out.groups[0].group_key == "workspace"

    def test_app_catalog_endpoint(self, transport: RBACTransport) -> None:
        transport.response = {"groups": []}
        svc.RBACService.Catalog.app("tenant-1")
        assert transport.only_request.endpoint == "/rbac/role-permissions/catalog/app"

    def test_dataset_catalog_endpoint(self, transport: RBACTransport) -> None:
        transport.response = {"groups": []}
        svc.RBACService.Catalog.dataset("tenant-1")
        assert transport.only_request.endpoint == "/rbac/role-permissions/catalog/dataset"


class TestRoles:
    def test_list_forwards_pagination_options(self, transport: RBACTransport) -> None:
        transport.response = {
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
            options=rbac_contracts.ListOption(page_number=2, results_per_page=50, reverse=True),
        )

        call = _call_args(transport)
        assert call.method == "GET"
        assert call.endpoint == "/rbac/roles"
        assert call.params == {
            "dataset_operator_enabled": False,
            "page_number": 2,
            "results_per_page": 50,
            "reverse": "true",
        }
        assert out.pagination
        assert out.pagination.total_count == 1

    def test_list_omits_params_when_default(self, transport: RBACTransport) -> None:
        transport.response = {"data": [], "pagination": None}
        svc.RBACService.Roles.list("tenant-1")
        assert _call_args(transport).params is not None

    def test_list_forwards_include_owner(self, transport: RBACTransport) -> None:
        transport.response = {"data": [], "pagination": None}

        svc.RBACService.Roles.list("tenant-1", include_owner=1)

        assert _call_args(transport).params == {"dataset_operator_enabled": False, "include_owner": 1}

    def test_list_coerces_null_permission_keys(self, transport: RBACTransport) -> None:
        transport.response = {
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

    def test_get_passes_id_query_param(self, transport: RBACTransport) -> None:
        transport.response = {"id": "role-1", "type": "workspace", "name": "Owner"}
        svc.RBACService.Roles.get("tenant-1", "acct-1", "role-1")
        call = _call_args(transport)
        assert call.method == "GET"
        assert call.endpoint == "/rbac/roles/item"
        assert call.params == {"billing_enabled": True, "id": "role-1"}

    def test_members_forwards_role_id_and_pagination(self, transport: RBACTransport) -> None:
        transport.response = {
            "role_id": "role-1",
            "data": [{"account_id": "acct-2", "account_name": "Alice"}],
            "pagination": {"total_count": 1, "per_page": 20, "current_page": 1, "total_pages": 1},
        }

        out = svc.RBACService.Roles.members(
            "tenant-1",
            "acct-1",
            "role-1",
            options=rbac_contracts.ListOption(page_number=1, results_per_page=20),
        )

        call = _call_args(transport)
        assert call.method == "GET"
        assert call.endpoint == "/rbac/roles/members"
        assert call.params == {"page_number": 1, "results_per_page": 20, "role_id": "role-1"}
        assert out.data[0].account_id == "acct-2"
        assert out.data[0].account_name == "Alice"
        assert out.pagination is not None
        assert out.pagination.total_count == 1

    def test_create_sends_body(self, transport: RBACTransport) -> None:
        transport.response = {"id": "role-1", "type": "workspace", "name": "Owner"}
        payload = rbac_contracts.RoleMutation(
            name="Owner", description="full access", permission_keys=["workspace.member.manage"]
        )
        svc.RBACService.Roles.create("tenant-1", "acct-1", payload)

        call = _call_args(transport)
        assert call.method == "POST"
        assert call.endpoint == "/rbac/roles"
        assert call.json == {
            "name": "Owner",
            "description": "full access",
            "permission_keys": ["workspace.member.manage"],
            "type": "workspace",
        }

    def test_update_sends_id_param_and_body(self, transport: RBACTransport) -> None:
        transport.response = {"id": "role-1", "type": "workspace", "name": "Owner"}
        payload = rbac_contracts.RoleMutation(name="Owner", permission_keys=["x"])
        svc.RBACService.Roles.update("tenant-1", "acct-1", "role-1", payload)

        call = _call_args(transport)
        assert call.method == "PUT"
        assert call.endpoint == "/rbac/roles/item"
        assert call.params == {"id": "role-1"}
        assert call.json == {"name": "Owner", "description": "", "permission_keys": ["x"], "type": "workspace"}

    def test_delete_uses_delete_method(self, transport: RBACTransport) -> None:
        transport.response = {"message": "success"}
        svc.RBACService.Roles.delete("tenant-1", None, "role-1")

        call = _call_args(transport)
        assert call.method == "DELETE"
        assert call.endpoint == "/rbac/roles/item"
        assert call.params == {"id": "role-1"}
        assert call.account_id is None

    def test_copy_sends_post_with_id_param(self, transport: RBACTransport) -> None:
        transport.response = {"id": "role-1-copy", "type": "workspace", "name": "Owner copy"}
        svc.RBACService.Roles.copy("tenant-1", "acct-1", "role-1")

        call = _call_args(transport)
        assert call.method == "POST"
        assert call.endpoint == "/rbac/roles/copy"
        assert call.params == {"id": "role-1"}
        assert call.account_id == "acct-1"


class TestAccessPolicyBindings:
    def test_lock_sends_put_with_binding_id(self, transport: RBACTransport) -> None:
        transport.response = {"binding_id": "binding-1", "is_locked": True}

        out = svc.RBACService.AccessPolicyBindings.lock("tenant-1", "acct-1", "binding-1")

        call = _call_args(transport)
        assert call.method == "PUT"
        assert call.endpoint == "/rbac/access-policy-bindings/lock"
        assert call.json == {"binding_id": "binding-1"}
        assert out.binding_id == "binding-1"
        assert out.is_locked is True

    def test_unlock_sends_put_with_binding_id(self, transport: RBACTransport) -> None:
        transport.response = {"binding_id": "binding-1", "is_locked": False}

        out = svc.RBACService.AccessPolicyBindings.unlock("tenant-1", "acct-1", "binding-1")

        call = _call_args(transport)
        assert call.method == "PUT"
        assert call.endpoint == "/rbac/access-policy-bindings/unlock"
        assert call.json == {"binding_id": "binding-1"}
        assert out.binding_id == "binding-1"
        assert out.is_locked is False


class TestAccessPolicies:
    def test_list_filters_by_resource_type(self, transport: RBACTransport) -> None:
        transport.response = {"data": [], "pagination": None}
        svc.RBACService.AccessPolicies.list(
            "tenant-1",
            "acct-1",
            resource_type=rbac_contracts.RBACResourceType.APP,
            options=rbac_contracts.ListOption(page_number=1),
        )
        call = _call_args(transport)
        assert call.endpoint == "/rbac/access-policies"
        assert call.params == {"page_number": 1, "resource_type": "app"}

    def test_copy_sends_post_with_id_param(self, transport: RBACTransport) -> None:
        transport.response = {
            "id": "policy-1-copy",
            "resource_type": "app",
            "name": "Full access copy",
        }
        svc.RBACService.AccessPolicies.copy("tenant-1", "acct-1", "policy-1")
        call = _call_args(transport)
        assert call.method == "POST"
        assert call.endpoint == "/rbac/access-policies/copy"
        assert call.params == {"id": "policy-1"}

    def test_create_serialises_resource_type_enum(self, transport: RBACTransport) -> None:
        transport.response = {"id": "policy-1", "resource_type": "dataset", "name": "KB only"}
        payload = rbac_contracts.AccessPolicyCreate(
            name="KB only",
            resource_type=rbac_contracts.RBACResourceType.DATASET,
            permission_keys=["dataset.acl.readonly"],
        )
        svc.RBACService.AccessPolicies.create("tenant-1", "acct-1", payload)
        call = _call_args(transport)
        assert call.method == "POST"
        assert call.json == {
            "name": "KB only",
            "resource_type": "dataset",
            "description": "",
            "permission_keys": ["dataset.acl.readonly"],
        }


class TestResourceAccess:
    def test_resource_whitelist_configs_batch_get(self, transport: RBACTransport) -> None:
        transport.response = {
            "data": [
                {
                    "resource_type": "app",
                    "resource_id": "app-1",
                    "scope": "all",
                    "automatic_include_workspace_members": True,
                    "account_ids": ["acct-1"],
                },
                {
                    "resource_type": "dataset",
                    "resource_id": "dataset-1",
                    "scope": "specific",
                    "automatic_include_workspace_members": False,
                    "account_ids": None,
                },
            ]
        }

        out = svc.RBACService.ResourceWhitelistConfigs.batch_get(
            "tenant-1",
            "acct-actor",
            [
                rbac_contracts.ResourceWhitelistConfigResource(
                    resource_type=rbac_contracts.RBACResourceType.APP, resource_id="app-1"
                ),
                rbac_contracts.ResourceWhitelistConfigResource(
                    resource_type=rbac_contracts.RBACResourceType.DATASET,
                    resource_id="dataset-1",
                ),
            ],
        )

        call = _call_args(transport)
        assert call.method == "POST"
        assert call.endpoint == "/rbac/whitelist/configs"
        assert call.json == {
            "resources": [
                {"resource_type": "app", "resource_id": "app-1"},
                {"resource_type": "dataset", "resource_id": "dataset-1"},
            ]
        }
        assert [item.resource_id for item in out.data] == ["app-1", "dataset-1"]
        assert out.data[0].automatic_include_workspace_members is True
        assert out.data[0].rbac_whitelist_scope == "all"
        assert out.data[1].account_ids == []

    def test_app_whitelist_resources(self, transport: RBACTransport) -> None:
        transport.response = {"unrestricted": True, "resource_ids": ["app-1", "app-2"]}

        out = svc._APP_ACCESS.whitelist_resources("tenant-1", "acct-1")

        call = _call_args(transport)
        assert call.method == "GET"
        assert call.endpoint == "/rbac/apps/whitelist/resources"
        assert call.params is None
        assert out.unrestricted is True
        assert out.resource_ids == ["app-1", "app-2"]

    def test_dataset_whitelist_resources(self, transport: RBACTransport) -> None:
        transport.response = {"resource_ids": ["dataset-1"]}

        out = svc._DATASET_ACCESS.whitelist_resources("tenant-1", "acct-1")

        call = _call_args(transport)
        assert call.method == "GET"
        assert call.endpoint == "/rbac/datasets/whitelist/resources"
        assert call.params is None
        assert out.resource_ids == ["dataset-1"]

    def test_app_user_access_policies(self, transport: RBACTransport) -> None:
        transport.response = {
            "scope": "specific",
            "pagination": {"total_count": 1, "per_page": 10, "current_page": 2, "total_pages": 3},
            "data": [
                {
                    "account": {"account_id": "acct-1", "account_name": "Alice"},
                    "roles": [
                        {
                            "id": "role-1",
                            "type": "workspace",
                            "name": "Editor",
                            "permission_keys": [],
                        }
                    ],
                    "access_policies": [
                        {
                            "id": "policy-1",
                            "resource_type": "app",
                            "name": "Can edit",
                        }
                    ],
                }
            ],
        }

        out = svc._APP_ACCESS.user_access_policies(
            "tenant-1",
            "acct-1",
            "app-1",
            options=rbac_contracts.ListOption(page_number=2, results_per_page=10, reverse=False),
        )

        call = _call_args(transport)
        assert call.method == "GET"
        assert call.endpoint == "/rbac/apps/user-access-policies"
        assert call.params == {
            "page_number": 2,
            "results_per_page": 10,
            "reverse": "false",
            "app_id": "app-1",
        }
        assert out.data[0].account.account_name == "Alice"
        assert out.data[0].roles[0].id == "role-1"
        assert out.data[0].access_policies[0].id == "policy-1"
        assert out.pagination
        assert out.pagination.current_page == 2
        assert "scope" not in out.model_dump(mode="json")

    def test_dataset_user_access_policies_forwards_pagination(self, transport: RBACTransport) -> None:
        transport.response = {
            "scope": "specific",
            "data": [],
            "pagination": {"total_count": 0, "per_page": 20, "current_page": 1, "total_pages": 0},
        }

        out = svc._DATASET_ACCESS.user_access_policies(
            "tenant-1",
            "acct-1",
            "dataset-1",
            options=rbac_contracts.ListOption(page_number=1, results_per_page=20, reverse=True),
        )

        call = _call_args(transport)
        assert call.method == "GET"
        assert call.endpoint == "/rbac/datasets/user-access-policies"
        assert call.params == {
            "page_number": 1,
            "results_per_page": 20,
            "reverse": "true",
            "dataset_id": "dataset-1",
        }
        assert out.pagination
        assert out.pagination.per_page == 20

    def test_dataset_replace_user_access_policies(self, transport: RBACTransport) -> None:
        transport.response = {"access_policies": [{"id": "policy-1", "resource_type": "dataset", "name": "Can edit"}]}
        payload = rbac_contracts.ReplaceUserAccessPolicies(access_policy_ids=["policy-1"])

        out = svc._DATASET_ACCESS.replace_user_access_policies(
            "tenant-1", "acct-actor", "dataset-1", "acct-target", payload
        )

        call = _call_args(transport)
        assert call.method == "PUT"
        assert call.endpoint == "/rbac/datasets/user-access-policies"
        assert call.params == {"dataset_id": "dataset-1", "account_id": "acct-target"}
        assert call.json == {"access_policy_ids": ["policy-1"]}
        assert out.access_policies[0].id == "policy-1"

    def test_app_append_whitelist_members_batch(self, transport: RBACTransport) -> None:
        transport.response = None

        svc._APP_ACCESS.append_whitelist_members_batch(
            "tenant-1",
            "acct-actor",
            [
                rbac_contracts.AppendAppWhitelistMembersBatchItem(
                    app_id="app-1",
                    account_ids=["acct-1", "acct-2"],
                    policy_id="policy-1",
                )
            ],
        )

        call = _call_args(transport)
        assert call.method == "POST"
        assert call.endpoint == "/rbac/apps/whitelist/members/batch"
        assert call.json == {
            "data": [{"app_id": "app-1", "account_ids": ["acct-1", "acct-2"], "policy_id": "policy-1"}]
        }

    def test_dataset_append_whitelist_members_batch(self, transport: RBACTransport) -> None:
        transport.response = None

        svc._DATASET_ACCESS.append_whitelist_members_batch(
            "tenant-1",
            "acct-actor",
            [
                rbac_contracts.AppendDatasetWhitelistMembersBatchItem(
                    dataset_id="dataset-1",
                    account_ids=["acct-1", "acct-2"],
                    policy_id="policy-1",
                )
            ],
        )

        call = _call_args(transport)
        assert call.method == "POST"
        assert call.endpoint == "/rbac/datasets/whitelist/members/batch"
        assert call.json == {
            "data": [{"dataset_id": "dataset-1", "account_ids": ["acct-1", "acct-2"], "policy_id": "policy-1"}]
        }

    def test_dataset_whitelist(self, transport: RBACTransport) -> None:
        transport.response = {"account_ids": ["acct-2"], "automatic_include_workspace_members": False}

        out = svc._DATASET_ACCESS.whitelist("tenant-1", "acct-1", "dataset-1")

        call = _call_args(transport)
        assert call.method == "GET"
        assert call.endpoint == "/rbac/datasets/whitelist"
        assert call.params == {"dataset_id": "dataset-1"}
        assert out.account_ids == ["acct-2"]

    def test_app_whitelist_config(self, transport: RBACTransport) -> None:
        transport.response = {
            "account_ids": ["acct-1"],
            "automatic_include_workspace_members": True,
        }

        out = svc._APP_ACCESS.whitelist_config("tenant-1", "acct-1", "app-1")

        call = _call_args(transport)
        assert call.method == "GET"
        assert call.endpoint == "/rbac/apps/whitelist"
        assert call.params == {"app_id": "app-1"}
        assert out.model_dump(mode="json") == {"automatic_include_workspace_members": True}

    def test_dataset_whitelist_config(self, transport: RBACTransport) -> None:
        transport.response = {
            "account_ids": ["acct-1"],
            "automatic_include_workspace_members": False,
            "scope": "specific",
        }

        out = svc._DATASET_ACCESS.whitelist_config("tenant-1", "acct-1", "dataset-1")

        call = _call_args(transport)
        assert call.method == "GET"
        assert call.endpoint == "/rbac/datasets/whitelist"
        assert call.params == {"dataset_id": "dataset-1"}
        assert out.model_dump(mode="json") == {"automatic_include_workspace_members": False}

    def test_dataset_legacy_whitelist_config_reads_old_scope_without_public_dump(
        self, transport: RBACTransport
    ) -> None:
        transport.response = {
            "account_ids": ["acct-1"],
            "automatic_include_workspace_members": False,
            "scope": "specific",
        }

        out = svc._DATASET_ACCESS.legacy_whitelist_config("tenant-1", "acct-1", "dataset-1")

        call = _call_args(transport)
        assert call.method == "GET"
        assert call.endpoint == "/rbac/datasets/whitelist"
        assert call.params == {"dataset_id": "dataset-1"}
        assert out.account_ids == ["acct-1"]
        assert out.rbac_whitelist_scope == "specific"

    def test_app_matrix(self, transport: RBACTransport) -> None:
        transport.response = {"resource_id": "app-1", "items": []}
        out = svc._APP_ACCESS.matrix("tenant-1", "acct-1", "app-1")
        call = _call_args(transport)
        assert call.method == "GET"
        assert call.endpoint == "/rbac/apps/access-policy"
        assert call.params == {"app_id": "app-1"}
        assert out.app_id == "app-1"

    def test_dataset_matrix(self, transport: RBACTransport) -> None:
        transport.response = {"resource_id": "dataset-1", "items": []}
        out = svc._DATASET_ACCESS.matrix("tenant-1", "acct-1", "dataset-1")
        call = _call_args(transport)
        assert call.method == "GET"
        assert call.endpoint == "/rbac/datasets/access-policy"
        assert call.params == {"dataset_id": "dataset-1"}
        assert out.dataset_id == "dataset-1"

    def test_app_role_bindings_preserve_role_name(self, transport: RBACTransport) -> None:
        transport.response = {
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

        out = svc._APP_ACCESS.list_role_bindings("tenant-1", "acct-1", "app-1", "policy-1")

        assert out.data[0].role_name == "Owner"

    def test_app_member_bindings_preserve_account_name(self, transport: RBACTransport) -> None:
        transport.response = {
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

        out = svc._APP_ACCESS.list_member_bindings("tenant-1", "acct-1", "app-1", "policy-1")

        assert out.data[0].account_name == "Alice"

    def test_app_delete_member_bindings_uses_delete_method(self, transport: RBACTransport) -> None:
        transport.response = None
        payload = rbac_contracts.DeleteMemberBindings(account_ids=["acct-2", "acct-3"])
        svc._APP_ACCESS.delete_member_bindings("tenant-1", "acct-1", "app-1", "policy-1", payload)
        call = _call_args(transport)
        assert call.method == "DELETE"
        assert call.endpoint == "/rbac/apps/access-policy/member-bindings"
        assert call.params == {"app_id": "app-1", "policy_id": "policy-1"}
        assert call.json == {"account_ids": ["acct-2", "acct-3"]}

    def test_dataset_delete_member_bindings_uses_delete_method(self, transport: RBACTransport) -> None:
        transport.response = None
        payload = rbac_contracts.DeleteMemberBindings(account_ids=["acct-2"])
        svc._DATASET_ACCESS.delete_member_bindings("tenant-1", "acct-1", "ds-1", "policy-1", payload)
        call = _call_args(transport)
        assert call.method == "DELETE"
        assert call.endpoint == "/rbac/datasets/access-policy/member-bindings"
        assert call.params == {"dataset_id": "ds-1", "policy_id": "policy-1"}
        assert call.json == {"account_ids": ["acct-2"]}


class TestWorkspaceAccess:
    def test_app_matrix(self, transport: RBACTransport) -> None:
        transport.response = {
            "items": [],
            "pagination": {"total_count": 1, "per_page": 20, "current_page": 2, "total_pages": 1},
        }
        out = svc._WORKSPACE_APP_ACCESS.matrix(
            "tenant-1",
            options=rbac_contracts.ListOption(page_number=2, results_per_page=20),
        )
        call = _call_args(transport)
        assert call.method == "GET"
        assert call.endpoint == "/rbac/workspace/apps/access-policy"
        assert call.params == {"page_number": 2, "results_per_page": 20}
        assert out.pagination
        assert out.pagination.current_page == 2

    def test_dataset_matrix(self, transport: RBACTransport) -> None:
        transport.response = {"items": []}
        svc._WORKSPACE_DATASET_ACCESS.matrix("tenant-1")
        call = _call_args(transport)
        assert call.method == "GET"
        assert call.endpoint == "/rbac/workspace/datasets/access-policy"
        assert call.params is None

    def test_workspace_matrix_coerces_null_bindings(self, transport: RBACTransport) -> None:
        transport.response = {
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

        out = svc._WORKSPACE_APP_ACCESS.matrix("tenant-1")

        assert out.items[0].roles == []
        assert out.items[0].accounts == []

    def test_workspace_app_replace_bindings(self, transport: RBACTransport) -> None:
        transport.response = {"data": []}
        payload = rbac_contracts.ReplaceBindings(role_ids=["workspace.editor"], account_ids=["acct-2"])
        svc._WORKSPACE_APP_ACCESS.replace_bindings("tenant-1", "acct-1", "policy-1", payload)
        call = _call_args(transport)
        assert call.method == "PUT"
        assert call.endpoint == "/rbac/workspace/apps/access-policy/bindings"
        assert call.params == {"policy_id": "policy-1"}
        assert call.json == {"role_ids": ["workspace.editor"], "account_ids": ["acct-2"]}

    def test_workspace_dataset_replace_bindings(self, transport: RBACTransport) -> None:
        transport.response = {"data": []}
        payload = rbac_contracts.ReplaceBindings(role_ids=["workspace.editor"], account_ids=["acct-2"])
        svc._WORKSPACE_DATASET_ACCESS.replace_bindings("tenant-1", "acct-1", "policy-1", payload)
        call = _call_args(transport)
        assert call.method == "PUT"
        assert call.endpoint == "/rbac/workspace/datasets/access-policy/bindings"
        assert call.params == {"policy_id": "policy-1"}
        assert call.json == {"role_ids": ["workspace.editor"], "account_ids": ["acct-2"]}

    def test_workspace_app_matrix_forwards_explicit_language(self, transport: RBACTransport) -> None:
        transport.response = {"items": [], "pagination": None}
        svc._WORKSPACE_APP_ACCESS.matrix("tenant-1", language="en")

        call = _call_args(transport)
        assert call.params == {"language": "en"}


class TestMyPermissions:
    @pytest.fixture(autouse=True)
    def _rbac_enabled(self, config_overrides: Callable[..., None]) -> None:
        config_overrides(RBAC_ENABLED=True)

    def test_resource_snapshot_maps_defaults_and_overrides(self) -> None:
        snapshot = rbac_contracts.ResourcePermissionSnapshot(
            default_permission_keys=["app.acl.view_layout"],
            overrides=[
                rbac_contracts.ResourcePermissionKeys(
                    resource_id="app-2",
                    permission_keys=["app.acl.view_layout", "app.acl.edit"],
                )
            ],
        )

        assert snapshot.permission_keys_by_resource_ids(["app-1", "app-2"]) == {
            "app-1": ["app.acl.view_layout"],
            "app-2": ["app.acl.view_layout", "app.acl.edit"],
        }

    def test_get_without_payload_uses_get(self, transport: RBACTransport) -> None:
        transport.response = {
            "workspace": {"permission_keys": ["workspace.member.manage"]},
            "app": {"default_permission_keys": ["app.acl.view_layout", "app.acl.test_and_run"], "overrides": []},
            "dataset": {"default_permission_keys": [], "overrides": []},
        }

        out = svc.RBACService.MyPermissions.get("tenant-1", "acct-1")

        call = _call_args(transport)
        assert call.method == "GET"
        assert call.endpoint == "/rbac/my-permissions"
        assert call.json is None
        assert call.params is None
        assert out.workspace.permission_keys == ["workspace.member.manage"]

    def test_get_with_single_resource_filters(self, transport: RBACTransport) -> None:
        transport.response = {
            "workspace": {"permission_keys": []},
            "app": {
                "default_permission_keys": [],
                "overrides": [{"resource_id": "app-1", "permission_keys": ["app.acl.edit"]}],
            },
            "dataset": {"default_permission_keys": [], "overrides": []},
        }

        out = svc.RBACService.MyPermissions.get("tenant-1", "acct-1", app_id="app-1")

        call = _call_args(transport)
        assert call.method == "GET"
        assert call.endpoint == "/rbac/my-permissions"
        assert call.params == {"app_id": "app-1"}
        assert out.app.overrides[0].resource_id == "app-1"

    def test_get_forwards_agent_id_and_parses_agent_snapshot(self, transport: RBACTransport) -> None:
        transport.response = {
            "workspace": {"permission_keys": []},
            "app": {"default_permission_keys": [], "overrides": []},
            "dataset": {"default_permission_keys": [], "overrides": []},
            "agent": {
                "default_permission_keys": ["agent.acl.preview"],
                "overrides": [{"resource_id": "agent-1", "permission_keys": ["agent.acl.edit"]}],
            },
        }

        out = svc.RBACService.MyPermissions.get("tenant-1", "acct-1", agent_id="agent-1")

        call = _call_args(transport)
        assert call.method == "GET"
        assert call.endpoint == "/rbac/my-permissions"
        assert call.params == {"agent_id": "agent-1"}
        assert out.agent.default_permission_keys == ["agent.acl.preview"]
        assert out.agent.overrides[0].resource_id == "agent-1"
        assert out.agent.overrides[0].permission_keys == ["agent.acl.edit"]


class TestMemberRoles:
    @pytest.fixture(autouse=True)
    def _rbac_enabled(self, config_overrides: Callable[..., None]) -> None:
        config_overrides(RBAC_ENABLED=True)

    def test_get(self, transport: RBACTransport) -> None:
        transport.response = {
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
        call = _call_args(transport)
        assert call.method == "GET"
        assert call.endpoint == "/rbac/members/rbac-roles"
        assert call.params == {"account_id": "acct-2"}
        assert out.account_id == "acct-2"
        assert out.roles[0].name == "Member"

    def test_replace(self, transport: RBACTransport) -> None:
        transport.response = {"account_id": "acct-2", "roles": []}
        svc.RBACService.MemberRoles.replace(
            "tenant-1",
            "acct-1",
            "acct-2",
            role_ids=["workspace.owner", "workspace.editor"],
        )
        call = _call_args(transport)
        assert call.method == "PUT"
        assert call.endpoint == "/rbac/members/rbac-roles"
        assert call.params == {"account_id": "acct-2"}
        assert call.json == {"role_ids": ["workspace.owner", "workspace.editor"]}

    def test_batch_get(self, transport: RBACTransport) -> None:
        transport.response = {
            "acct-2": [
                {"id": "role-1", "name": "Admin", "type": "workspace"},
                {"id": "role-2", "name": "Editor", "type": "workspace"},
            ],
            "acct-3": [],
        }

        out = svc.RBACService.MemberRoles.batch_get("tenant-1", "acct-1", ["acct-2", "acct-3"])

        call = _call_args(transport)
        assert call.method == "POST"
        assert call.endpoint == "/rbac/members/rbac-roles/batch"
        assert call.json == {"member_ids": ["acct-2", "acct-3"]}
        assert out[0].account_id == "acct-2"
        assert len(out[0].roles) == 2
        assert out[1].account_id == "acct-3"
        assert out[1].roles == []


class TestResourcePermissions:
    @pytest.fixture(autouse=True)
    def _rbac_enabled(self, config_overrides: Callable[..., None]) -> None:
        config_overrides(RBAC_ENABLED=True)

    def test_app_permissions_batch_get(self, transport: RBACTransport) -> None:
        transport.response = {
            "data": [
                {
                    "resource_id": "app-1",
                    "permission_keys": ["app.acl.view_layout", "app.acl.edit", "app.acl.deploy"],
                },
                {"resource_id": "app-2", "permission_keys": []},
            ]
        }

        out = svc.RBACService.AppPermissions.batch_get("tenant-1", "acct-1", ["app-1", "app-2"])

        call = _call_args(transport)
        assert call.method == "POST"
        assert call.endpoint == "/rbac/apps/permission-keys/batch"
        assert call.json == {"app_ids": ["app-1", "app-2"]}
        assert out == {
            "app-1": ["app.acl.view_layout", "app.acl.edit", "app.acl.deploy"],
            "app-2": [],
        }

    def test_dataset_permissions_batch_get(self, transport: RBACTransport) -> None:
        transport.response = {
            "data": [
                {"resource_id": "ds-1", "permission_keys": ["dataset.acl.readonly"]},
                {"resource_id": "ds-2", "permission_keys": ["dataset.acl.edit"]},
            ]
        }

        out = svc.RBACService.DatasetPermissions.batch_get("tenant-1", "acct-1", ["ds-1", "ds-2"])

        call = _call_args(transport)
        assert call.method == "POST"
        assert call.endpoint == "/rbac/datasets/permission-keys/batch"
        assert call.json == {"dataset_ids": ["ds-1", "ds-2"]}
        assert out == {
            "ds-1": ["dataset.acl.readonly"],
            "ds-2": ["dataset.acl.edit"],
        }


class TestListOption:
    def test_empty_produces_empty_params(self) -> None:
        assert rbac_contracts.ListOption().to_params() == {}

    def test_reverse_serialises_as_lowercase_bool(self) -> None:
        assert rbac_contracts.ListOption(reverse=False).to_params()["reverse"] == "false"
        assert rbac_contracts.ListOption(reverse=True).to_params()["reverse"] == "true"

    def test_extra_overrides_merge(self) -> None:
        assert rbac_contracts.ListOption(page_number=1).to_params({"resource_type": "app", "skip": None}) == {
            "page_number": 1,
            "resource_type": "app",
        }
