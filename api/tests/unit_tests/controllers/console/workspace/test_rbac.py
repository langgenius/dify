"""Controller tests for ``controllers.console.workspace.rbac``.

The controllers here are thin: almost every non-trivial behaviour lives in
``services.enterprise.rbac_service`` (covered by its own suite). These tests
therefore focus on the Flask-layer concerns the service layer cannot exercise:

* ``_current_ids`` raises 404 when the session has no tenant.
* The pydantic request models accept / reject bodies as expected.

We explicitly avoid "happy-path" integration tests through the full
decorator stack — those belong in e2e tests where a real Dify session is
available — to keep this suite fast and resilient to ancillary auth wiring
changes.
"""

from __future__ import annotations

import inspect
from unittest.mock import patch

import pytest
from flask import Flask
from pydantic import ValidationError
from werkzeug.exceptions import Forbidden, NotFound

from configs import dify_config
from controllers.console.workspace import rbac as rbac_mod
from controllers.console.workspace.rbac import _RolesListQuery
from enums import DeploymentEdition
from models import Account


@pytest.fixture
def app():
    flask_app = Flask(__name__)
    flask_app.config["TESTING"] = True
    return flask_app


@pytest.fixture(autouse=True)
def _rbac_config(config_overrides) -> None:
    config_overrides(
        DEPLOYMENT_EDITION=DeploymentEdition.ENTERPRISE,
        RBAC_ENABLED=True,
        LOGIN_DISABLED=True,
    )


def _account() -> Account:
    account = Account(name="RBAC User", email="rbac@example.com")
    account.id = "acct-1"
    return account


class TestCurrentIds:
    def test_rejects_missing_tenant(self):
        with patch("controllers.console.workspace.rbac.current_account_with_tenant") as mock_user:
            mock_user.return_value = (_account(), None)
            with pytest.raises(NotFound):
                rbac_mod._current_ids()

    def test_returns_tuple(self):
        with patch("controllers.console.workspace.rbac.current_account_with_tenant") as mock_user:
            mock_user.return_value = (_account(), "tenant-1")
            assert rbac_mod._current_ids() == ("tenant-1", "acct-1")


class TestMyPermissions:
    def test_returns_app_deploy_permission(self, app):
        permissions = rbac_mod.svc.MyPermissionsResponse(
            app=rbac_mod.svc.ResourcePermissionSnapshot(
                default_permission_keys=["app.acl.deploy"],
            )
        )
        with (
            app.test_request_context("/workspaces/current/rbac/my-permissions"),
            patch("controllers.console.workspace.rbac._current_ids", return_value=("tenant-1", "acct-1")),
            patch(
                "controllers.console.workspace.rbac.svc.RBACService.MyPermissions.get",
                return_value=permissions,
            ) as mock_get,
        ):
            response = inspect.unwrap(rbac_mod.RBACMyPermissionsApi.get)(rbac_mod.RBACMyPermissionsApi())

        assert response["app"]["default_permission_keys"] == ["app.acl.deploy"]
        mock_get.assert_called_once()


class TestAccessMatrixAccountNames:
    def test_hydrates_missing_account_names(self):
        items = [
            rbac_mod.svc.AccessMatrixItem(
                accounts=[
                    {"account_id": "acct-1", "account_name": "Alice", "binding_id": "binding-1"},
                    {"account_id": "acct-2", "account_name": "", "binding_id": "binding-2"},
                ]
            )
        ]

        with patch(
            "controllers.console.workspace.rbac._account_names_by_ids",
            return_value={"acct-2": {"name": "Bob", "avatar": "ava"}},
        ) as mock_names:
            rbac_mod._hydrate_access_matrix_account_names(items)

        mock_names.assert_called_once_with(["acct-2"])
        assert items[0].accounts[0].account_id == "acct-1"
        assert items[0].accounts[0].account_name == "Alice"
        assert items[0].accounts[1].account_id == "acct-2"
        assert items[0].accounts[1].account_name == "Bob"
        assert items[0].accounts[1].avatar == "ava"

    def test_hydrates_resource_user_account_names(self):
        items = [
            rbac_mod.svc.ResourceUserAccessPolicies(
                account={"account_id": "acct-1", "account_name": ""},
                roles=[],
                access_policies=[],
            )
        ]

        with patch(
            "controllers.console.workspace.rbac._account_names_by_ids",
            return_value={"acct-1": {"name": "Alice", "avatar": ""}},
        ):
            rbac_mod._hydrate_resource_user_account_names(items)

        assert items[0].account.account_name == "Alice"


class TestPydanticModels:
    """The internal `_…Request` models are the contract between the browser
    and the controllers. We only check non-obvious branches (enum parsing,
    missing required fields) — trivial `str` fields are not worth asserting.
    """

    def test_role_upsert_requires_name(self):
        with pytest.raises(ValidationError):
            rbac_mod._RoleUpsertRequest.model_validate({})

    def test_role_upsert_to_mutation_preserves_fields(self):
        payload = rbac_mod._RoleUpsertRequest.model_validate(
            {
                "name": "Owner",
                "description": "full access",
                "permission_keys": ["workspace.member.manage"],
            }
        )
        mutation = payload.to_mutation()
        assert mutation.description == "full access"
        assert mutation.permission_keys == ["workspace.member.manage"]

    def test_access_policy_create_parses_resource_type_enum(self):
        parsed = rbac_mod._AccessPolicyCreateRequest.model_validate(
            {
                "name": "Full access",
                "resource_type": "app",
                "description": "",
                "permission_keys": [],
            }
        )
        assert parsed.resource_type is rbac_mod.svc.RBACResourceType.APP

    def test_access_policy_create_rejects_unknown_resource_type(self):
        with pytest.raises(ValidationError):
            rbac_mod._AccessPolicyCreateRequest.model_validate({"name": "bad", "resource_type": "unknown"})

    def test_resource_access_scope_requires_scope(self):
        with pytest.raises(ValidationError):
            rbac_mod._ResourceAccessScopeRequest.model_validate({})

    def test_resource_access_scope_defaults_empty_account_ids(self):
        parsed = rbac_mod._ResourceAccessScopeRequest.model_validate({"scope": "specific"})
        assert parsed.scope is rbac_mod.RBACResourceWhitelistScope.SPECIFIC

    def test_resource_access_scope_coerce_null_account_ids(self):
        rbac_mod._ResourceAccessScopeRequest.model_validate({"scope": "all"})

    def test_resource_access_scope_rejects_unknown_scope(self):
        with pytest.raises(ValidationError):
            rbac_mod._ResourceAccessScopeRequest.model_validate({"scope": "team"})

    def test_replace_bindings_keeps_role_binding_contract(self):
        parsed = rbac_mod._ReplaceBindingsRequest.model_validate({"role_ids": None})
        assert parsed.role_ids == []

    def test_replace_member_roles_coerce_null_list(self):
        parsed = rbac_mod._ReplaceMemberRolesRequest.model_validate({"role_ids": None})
        assert parsed.role_ids == []

    def test_pagination_query_accepts_page_and_limit_aliases(self):
        parsed = rbac_mod._PaginationQuery.model_validate({"page": 3, "limit": 25, "reverse": True})
        assert parsed.page_number == 3
        assert parsed.results_per_page == 25
        assert parsed.reverse is True

    def test_pagination_query_accepts_legacy_inner_names(self):
        parsed = rbac_mod._PaginationQuery.model_validate({"page_number": 4, "results_per_page": 30, "reverse": False})
        assert parsed.page_number == 4
        assert parsed.results_per_page == 30
        assert parsed.reverse is False


class TestPaginationMapping:
    def test_roles_get_returns_legacy_compatible_roles_when_rbac_disabled(self, app, config_overrides):
        config_overrides(RBAC_ENABLED=False)
        with (
            app.test_request_context("/workspaces/current/rbac/roles?page=1&limit=2&include_owner=1"),
            patch("controllers.console.workspace.rbac._current_ids", return_value=("tenant-1", "acct-1")),
            patch("controllers.console.workspace.rbac.svc.RBACService.Roles.list") as mock_list,
        ):
            response = inspect.unwrap(rbac_mod.RBACRolesApi.get)(
                rbac_mod.RBACRolesApi(),
                _RolesListQuery.model_validate({"page": 1, "limit": 2, "include_owner": 1}),
            )

        owner_permission_keys = rbac_mod._LEGACY_ROLE_PERMISSION_KEYS["owner"]
        valid_owner_permission_keys = []
        for permission_key in owner_permission_keys:
            if dify_config.DEPLOYMENT_EDITION != DeploymentEdition.CLOUD and "billing" in permission_key:
                continue
            valid_owner_permission_keys.append(permission_key)

        admin_permission_keys = rbac_mod._LEGACY_ROLE_PERMISSION_KEYS["admin"]
        valid_admin_permission_keys = []
        for permission_key in admin_permission_keys:
            if dify_config.DEPLOYMENT_EDITION != DeploymentEdition.CLOUD and "billing" in permission_key:
                continue
            valid_admin_permission_keys.append(permission_key)

        assert response["data"] == [
            {
                "id": "owner",
                "tenant_id": "",
                "type": "workspace",
                "category": "global_system_default",
                "name": "owner",
                "description": "",
                "is_builtin": True,
                "permission_keys": valid_owner_permission_keys,
                "role_tag": "owner",
            },
            {
                "id": "admin",
                "tenant_id": "",
                "type": "workspace",
                "category": "global_system_default",
                "name": "admin",
                "description": "",
                "is_builtin": True,
                "permission_keys": valid_admin_permission_keys,
                "role_tag": "",
            },
        ]
        assert response["pagination"] == {
            "total_count": 4,
            "per_page": 2,
            "current_page": 1,
            "total_pages": 2,
        }
        mock_list.assert_not_called()

    def test_roles_get_filters_out_owner_when_include_owner_is_zero(self, app, config_overrides):
        config_overrides(RBAC_ENABLED=False)
        with (
            app.test_request_context("/workspaces/current/rbac/roles?include_owner=0"),
            patch("controllers.console.workspace.rbac._current_ids", return_value=("tenant-1", "acct-1")),
            patch("controllers.console.workspace.rbac.svc.RBACService.Roles.list"),
        ):
            response = inspect.unwrap(rbac_mod.RBACRolesApi.get)(rbac_mod.RBACRolesApi(), _RolesListQuery())

        names = [r["name"] for r in response["data"]]
        assert "owner" not in names

    def test_roles_get_keeps_owner_when_include_owner_is_one(self, app, config_overrides):
        config_overrides(RBAC_ENABLED=False)
        with (
            app.test_request_context("/workspaces/current/rbac/roles?include_owner=1"),
            patch("controllers.console.workspace.rbac._current_ids", return_value=("tenant-1", "acct-1")),
            patch("controllers.console.workspace.rbac.svc.RBACService.Roles.list"),
        ):
            response = inspect.unwrap(rbac_mod.RBACRolesApi.get)(
                rbac_mod.RBACRolesApi(),
                _RolesListQuery.model_validate({"include_owner": 1}),
            )

        names = [r["name"] for r in response["data"]]
        assert "owner" in names

    def test_roles_get_filters_out_owner_by_default(self, app, config_overrides):
        config_overrides(RBAC_ENABLED=False)
        with (
            app.test_request_context("/workspaces/current/rbac/roles"),
            patch("controllers.console.workspace.rbac._current_ids", return_value=("tenant-1", "acct-1")),
            patch("controllers.console.workspace.rbac.svc.RBACService.Roles.list"),
        ):
            response = inspect.unwrap(rbac_mod.RBACRolesApi.get)(rbac_mod.RBACRolesApi(), _RolesListQuery())

        names = [r["name"] for r in response["data"]]
        assert "owner" not in names

    def test_roles_get_forwards_outer_pagination_params(self, app):
        with (
            app.test_request_context("/workspaces/current/rbac/roles?page=2&limit=50&reverse=true&include_owner=1"),
            patch("controllers.console.workspace.rbac._current_ids", return_value=("tenant-1", "acct-1")),
            patch("controllers.console.workspace.rbac.svc.RBACService.Roles.list") as mock_list,
            patch("controllers.console.workspace.rbac._dump", return_value={}),
        ):
            inspect.unwrap(rbac_mod.RBACRolesApi.get)(
                rbac_mod.RBACRolesApi(),
                _RolesListQuery.model_validate({"page": 2, "limit": 50, "reverse": True, "include_owner": 1}),
            )

        _, kwargs = mock_list.call_args
        options = kwargs["options"]
        assert options.page_number == 2
        assert options.results_per_page == 50
        assert options.reverse is True


class TestResourceAccessScopeBindings:
    def test_app_whitelist_all_schedules_member_policy_sync(self, app):
        with (
            app.test_request_context(
                "/workspaces/current/rbac/apps/app-1/whitelist",
                method="PUT",
                json={"scope": "all"},
            ),
            patch("controllers.console.workspace.rbac._current_ids", return_value=("tenant-1", "acct-actor")),
            patch(
                "controllers.console.workspace.rbac.svc.RBACService.AppAccess.replace_whitelist",
                return_value=rbac_mod.svc.ResourceWhitelist(),
            ),
            patch("controllers.console.workspace.rbac.initialize_created_app_rbac_access_task") as mock_sync_task,
        ):
            inspect.unwrap(rbac_mod.RBACAppWhitelistApi.put)(rbac_mod.RBACAppWhitelistApi(), "app-1")

        mock_sync_task.delay.assert_called_once_with("tenant-1", "acct-actor", "app-1")

    def test_dataset_whitelist_all_schedules_member_policy_sync(self, app):
        # Widening a dataset to the whole workspace only records the scope; without granting the
        # default policy to the current members nobody actually gains access.
        with (
            app.test_request_context(
                "/workspaces/current/rbac/datasets/dataset-1/whitelist",
                method="PUT",
                json={"scope": "all"},
            ),
            patch("controllers.console.workspace.rbac._current_ids", return_value=("tenant-1", "acct-actor")),
            patch(
                "controllers.console.workspace.rbac.svc.RBACService.DatasetAccess.replace_whitelist",
                return_value=rbac_mod.svc.ResourceWhitelist(),
            ),
            patch("controllers.console.workspace.rbac.initialize_created_app_rbac_access_task") as mock_sync_task,
        ):
            inspect.unwrap(rbac_mod.RBACDatasetWhitelistApi.put)(rbac_mod.RBACDatasetWhitelistApi(), "dataset-1")

        mock_sync_task.delay.assert_called_once_with("tenant-1", "acct-actor", dataset_id="dataset-1")

    def test_dataset_whitelist_specific_does_not_schedule_member_policy_sync(self, app):
        with (
            app.test_request_context(
                "/workspaces/current/rbac/datasets/dataset-1/whitelist",
                method="PUT",
                json={"scope": "specific"},
            ),
            patch("controllers.console.workspace.rbac._current_ids", return_value=("tenant-1", "acct-actor")),
            patch(
                "controllers.console.workspace.rbac.svc.RBACService.DatasetAccess.replace_whitelist",
                return_value=rbac_mod.svc.ResourceWhitelist(),
            ),
            patch("controllers.console.workspace.rbac.initialize_created_app_rbac_access_task") as mock_sync_task,
        ):
            inspect.unwrap(rbac_mod.RBACDatasetWhitelistApi.put)(rbac_mod.RBACDatasetWhitelistApi(), "dataset-1")

        mock_sync_task.delay.assert_not_called()

    def test_app_user_access_policy_assignment_forwards_ids(self, app):
        with (
            app.test_request_context(
                "/workspaces/current/rbac/apps/app-1/users/acct-target/access-policies",
                method="PUT",
                json={"access_policy_ids": ["policy-1", "policy-2"]},
            ),
            patch("controllers.console.workspace.rbac._current_ids", return_value=("tenant-1", "acct-actor")),
            patch(
                "controllers.console.workspace.rbac.svc.RBACService.AppAccess.replace_user_access_policies"
            ) as mock_replace,
            patch("controllers.console.workspace.rbac._dump", return_value={}),
        ):
            inspect.unwrap(rbac_mod.RBACAppUserAccessPolicyAssignmentApi.put)(
                rbac_mod.RBACAppUserAccessPolicyAssignmentApi(),
                "app-1",
                "acct-target",
            )

        tenant_id, actor_id, app_id, target_id, payload = mock_replace.call_args.args
        assert (tenant_id, actor_id, app_id, target_id) == (
            "tenant-1",
            "acct-actor",
            "app-1",
            "acct-target",
        )
        assert payload.access_policy_ids == ["policy-1", "policy-2"]

    def test_app_member_bindings_delete_forwards_account_ids(self, app):
        with (
            app.test_request_context(
                "/workspaces/current/rbac/apps/app-1/access-policies/policy-1/member-bindings",
                method="DELETE",
                json={"account_ids": ["acct-2", "acct-3"]},
            ),
            patch("controllers.console.workspace.rbac._current_ids", return_value=("tenant-1", "acct-actor")),
            patch("controllers.console.workspace.rbac.svc.RBACService.AppAccess.delete_member_bindings") as mock_delete,
        ):
            response = inspect.unwrap(rbac_mod.RBACAppMemberBindingsApi.delete)(
                rbac_mod.RBACAppMemberBindingsApi(),
                "app-1",
                "policy-1",
            )

        assert response == {"result": "success"}
        tenant_id, actor_id, app_id, policy_id, payload = mock_delete.call_args.args
        assert (tenant_id, actor_id, app_id, policy_id) == ("tenant-1", "acct-actor", "app-1", "policy-1")
        assert payload.account_ids == ["acct-2", "acct-3"]

    def test_dataset_member_bindings_delete_forwards_account_ids(self, app):
        with (
            app.test_request_context(
                "/workspaces/current/rbac/datasets/dataset-1/access-policies/policy-1/member-bindings",
                method="DELETE",
                json={"account_ids": ["acct-2"]},
            ),
            patch("controllers.console.workspace.rbac._current_ids", return_value=("tenant-1", "acct-actor")),
            patch(
                "controllers.console.workspace.rbac.svc.RBACService.DatasetAccess.delete_member_bindings"
            ) as mock_delete,
        ):
            response = inspect.unwrap(rbac_mod.RBACDatasetMemberBindingsApi.delete)(
                rbac_mod.RBACDatasetMemberBindingsApi(),
                "dataset-1",
                "policy-1",
            )

        assert response == {"result": "success"}
        tenant_id, actor_id, dataset_id, policy_id, payload = mock_delete.call_args.args
        assert (tenant_id, actor_id, dataset_id, policy_id) == ("tenant-1", "acct-actor", "dataset-1", "policy-1")
        assert payload.account_ids == ["acct-2"]


class TestPaginationForwarding:
    def test_access_policies_get_forwards_outer_pagination_params(self, app):
        with (
            app.test_request_context(
                "/workspaces/current/rbac/access-policies?resource_type=app&page=3&limit=25&reverse=false"
            ),
            patch("controllers.console.workspace.rbac._current_ids", return_value=("tenant-1", "acct-1")),
            patch("controllers.console.workspace.rbac.svc.RBACService.AccessPolicies.list") as mock_list,
            patch("controllers.console.workspace.rbac._dump", return_value={}),
        ):
            inspect.unwrap(rbac_mod.RBACAccessPoliciesApi.get)(rbac_mod.RBACAccessPoliciesApi())

        _, kwargs = mock_list.call_args
        assert kwargs["resource_type"] == "app"
        options = kwargs["options"]
        assert options.page_number == 3
        assert options.results_per_page == 25
        assert options.reverse is False

    def test_workspace_app_matrix_forwards_outer_pagination_params(self, app):
        with (
            app.test_request_context("/workspaces/current/rbac/workspace/apps/access-policy?page=4&limit=10"),
            patch("controllers.console.workspace.rbac._current_ids", return_value=("tenant-1", "acct-1")),
            patch("controllers.console.workspace.rbac.svc.RBACService.WorkspaceAccess.app_matrix") as mock_list,
            patch("controllers.console.workspace.rbac._dump", return_value={}),
        ):
            inspect.unwrap(rbac_mod.RBACWorkspaceAppMatrixApi.get)(rbac_mod.RBACWorkspaceAppMatrixApi())

        _, kwargs = mock_list.call_args
        options = kwargs["options"]
        assert options.page_number == 4
        assert options.results_per_page == 10
        assert options.reverse is None

    def test_workspace_dataset_matrix_forwards_outer_pagination_params(self, app):
        with (
            app.test_request_context(
                "/workspaces/current/rbac/workspace/datasets/access-policy?page=5&limit=15&reverse=true"
            ),
            patch("controllers.console.workspace.rbac._current_ids", return_value=("tenant-1", "acct-1")),
            patch("controllers.console.workspace.rbac.svc.RBACService.WorkspaceAccess.dataset_matrix") as mock_list,
            patch("controllers.console.workspace.rbac._dump", return_value={}),
        ):
            inspect.unwrap(rbac_mod.RBACWorkspaceDatasetMatrixApi.get)(rbac_mod.RBACWorkspaceDatasetMatrixApi())

        _, kwargs = mock_list.call_args
        options = kwargs["options"]
        assert options.page_number == 5
        assert options.results_per_page == 15
        assert options.reverse is True


class TestAccessPolicyBindingLockUnlock:
    def test_lock_forwards_binding_id(self, app):
        with (
            app.test_request_context("/workspaces/current/rbac/access-policy-bindings/binding-1/lock", method="PUT"),
            patch("controllers.console.workspace.rbac._current_ids", return_value=("tenant-1", "acct-1")),
            patch("controllers.console.workspace.rbac.svc.RBACService.AccessPolicyBindings.lock") as mock_lock,
            patch("controllers.console.workspace.rbac._dump", return_value={}),
        ):
            inspect.unwrap(rbac_mod.RBACAccessPolicyBindingLockApi.put)(
                rbac_mod.RBACAccessPolicyBindingLockApi(), "binding-1"
            )

        mock_lock.assert_called_once_with("tenant-1", "acct-1", "binding-1")

    def test_unlock_forwards_binding_id(self, app):
        with (
            app.test_request_context("/workspaces/current/rbac/access-policy-bindings/binding-1/unlock", method="PUT"),
            patch("controllers.console.workspace.rbac._current_ids", return_value=("tenant-1", "acct-1")),
            patch("controllers.console.workspace.rbac.svc.RBACService.AccessPolicyBindings.unlock") as mock_unlock,
            patch("controllers.console.workspace.rbac._dump", return_value={}),
        ):
            inspect.unwrap(rbac_mod.RBACAccessPolicyBindingUnlockApi.put)(
                rbac_mod.RBACAccessPolicyBindingUnlockApi(), "binding-1"
            )

        mock_unlock.assert_called_once_with("tenant-1", "acct-1", "binding-1")


class TestRoleCopy:
    def test_role_copy_forwards_path_id(self, app):
        with (
            app.test_request_context("/workspaces/current/rbac/roles/role-1/copy", method="POST", json={}),
            patch("controllers.console.workspace.rbac._current_ids", return_value=("tenant-1", "acct-1")),
            patch("controllers.console.workspace.rbac.svc.RBACService.Roles.copy") as mock_copy,
            patch("controllers.console.workspace.rbac._dump", return_value={}),
        ):
            inspect.unwrap(rbac_mod.RBACRoleCopyApi.post)(rbac_mod.RBACRoleCopyApi(), "role-1")

        mock_copy.assert_called_once_with("tenant-1", "acct-1", "role-1", copy_member=True)


class TestWorkspaceRbacGuards:
    def test_role_create_requires_workspace_role_manage(self, app):
        with (
            app.test_request_context(
                "/workspaces/current/rbac/roles",
                method="POST",
                json={"name": "test_role", "permission_keys": []},
            ),
            patch(
                "controllers.common.wraps.current_account_with_tenant",
                return_value=(_account(), "tenant-1"),
            ),
            patch("controllers.common.wraps.RBACService.CheckAccess.check", return_value=False),
            patch("controllers.console.workspace.rbac.svc.RBACService.Roles.create") as mock_create,
        ):
            with pytest.raises(Forbidden):
                rbac_mod.RBACRolesApi().post()

        mock_create.assert_not_called()

    def test_access_policy_create_requires_workspace_role_manage(self, app):
        with (
            app.test_request_context(
                "/workspaces/current/rbac/access-policies",
                method="POST",
                json={"name": "full_access", "resource_type": "app", "permission_keys": []},
            ),
            patch(
                "controllers.common.wraps.current_account_with_tenant",
                return_value=(_account(), "tenant-1"),
            ),
            patch("controllers.common.wraps.RBACService.CheckAccess.check", return_value=False),
            patch("controllers.console.workspace.rbac.svc.RBACService.AccessPolicies.create") as mock_create,
        ):
            with pytest.raises(Forbidden):
                rbac_mod.RBACAccessPoliciesApi().post()

        mock_create.assert_not_called()


class TestDumpHelper:
    def test_dump_returns_plain_dict(self):
        role = rbac_mod.svc.RBACRole(id="role-1", type="workspace", name="Owner")
        dumped = rbac_mod._dump(role)
        assert isinstance(dumped, dict)
        assert "role_id" not in dumped
