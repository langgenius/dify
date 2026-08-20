"""Controller tests for ``controllers.console.workspace.rbac``.

The controllers here are thin: almost every non-trivial behaviour lives in
``services.enterprise.rbac_service`` (covered by its own suite). These tests
therefore focus on the Flask-layer concerns the service layer cannot exercise:

* ``_current_ids`` raises 404 when the session has no tenant.
* Tenant-scoped response hydration cannot leak foreign workspace members.
* The pydantic request models accept / reject bodies as expected.
* RBAC management routes carry the correct shared authorization policy.

We call unwrapped handlers for transport-only behaviour and leave the full
decorator stack to e2e tests where a real Dify session is available.
"""

from __future__ import annotations

import inspect
from types import SimpleNamespace
from unittest.mock import patch

import pytest
from flask import Flask
from pydantic import ValidationError
from werkzeug.exceptions import Forbidden, NotFound

from configs import dify_config
from controllers.console.workspace import rbac as rbac_mod
from controllers.console.workspace.rbac import _RolesListQuery
from enums import DeploymentEdition
from models import Account, Tenant, TenantAccountJoin, TenantAccountRole


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


_USER_ACCESS_POLICY_CASES = [
    (
        rbac_mod.RBACAppUserAccessPolicyAssignmentApi,
        "controllers.console.workspace.rbac.svc.RBACService.AppAccess.replace_user_access_policies",
        "app-1",
    ),
    (
        rbac_mod.RBACDatasetUserAccessPolicyAssignmentApi,
        "controllers.console.workspace.rbac.svc.RBACService.DatasetAccess.replace_user_access_policies",
        "dataset-1",
    ),
]

_WORKSPACE_BINDING_CASES = [
    (
        rbac_mod.RBACWorkspaceAppBindingsApi,
        "controllers.console.workspace.rbac.svc.RBACService.WorkspaceAccess.replace_app_bindings",
    ),
    (
        rbac_mod.RBACWorkspaceDatasetBindingsApi,
        "controllers.console.workspace.rbac.svc.RBACService.WorkspaceAccess.replace_dataset_bindings",
    ),
]


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
    @pytest.mark.parametrize(
        ("resource_class", "service_owner", "service_method", "result_attribute", "resource_id"),
        [
            (rbac_mod.RBACAppMatrixApi, rbac_mod.svc.RBACService.AppAccess, "matrix", "items", "app-1"),
            (
                rbac_mod.RBACAppUserAccessPoliciesApi,
                rbac_mod.svc.RBACService.AppAccess,
                "user_access_policies",
                "data",
                "app-1",
            ),
            (rbac_mod.RBACDatasetMatrixApi, rbac_mod.svc.RBACService.DatasetAccess, "matrix", "items", "dataset-1"),
            (
                rbac_mod.RBACDatasetUserAccessPoliciesApi,
                rbac_mod.svc.RBACService.DatasetAccess,
                "user_access_policies",
                "data",
                "dataset-1",
            ),
        ],
    )
    def test_resource_reads_hydrate_tenant_members(
        self,
        resource_class,
        service_owner,
        service_method,
        result_attribute,
        resource_id,
    ):
        result = SimpleNamespace(**{result_attribute: []})
        hydrator = (
            "_hydrate_access_matrix_account_names"
            if result_attribute == "items"
            else "_hydrate_resource_user_account_names"
        )
        with (
            patch("controllers.console.workspace.rbac._current_ids", return_value=("tenant-1", "acct-actor")),
            patch.object(service_owner, service_method, return_value=result) as fetch,
            patch.object(rbac_mod, hydrator) as hydrate,
            patch.object(rbac_mod, "_dump", return_value={}),
        ):
            response = inspect.unwrap(resource_class.get)(resource_class(), resource_id)

        assert response == {}
        fetch.assert_called_once_with("tenant-1", "acct-actor", resource_id)
        hydrate.assert_called_once_with("tenant-1", vars(result)[result_attribute])

    def test_hydrates_missing_account_names(self):
        items = [
            rbac_mod.svc.AccessMatrixItem(
                accounts=[
                    {"account_id": "acct-1", "account_name": "forged", "binding_id": "binding-1"},
                    {"account_id": "acct-2", "account_name": "", "binding_id": "binding-2"},
                    {"account_id": "foreign", "account_name": "Foreign", "binding_id": "binding-3"},
                ]
            )
        ]

        with patch(
            "controllers.console.workspace.rbac._account_names_by_ids",
            return_value={
                "acct-1": {"name": "Alice", "avatar": "", "email": "alice@example.com"},
                "acct-2": {"name": "Bob", "avatar": "ava", "email": "bob@example.com"},
            },
        ) as mock_names:
            rbac_mod._hydrate_access_matrix_account_names("tenant-1", items)

        mock_names.assert_called_once_with("tenant-1", ["acct-1", "acct-2", "foreign"])
        assert [account.account_id for account in items[0].accounts] == ["acct-1", "acct-2"]
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
            return_value={"acct-1": {"name": "Alice", "avatar": "", "email": "alice@example.com"}},
        ):
            rbac_mod._hydrate_resource_user_account_names("tenant-1", items)

        assert items[0].account.account_name == "Alice"

    def test_account_names_are_scoped_to_tenant(self, sqlite_session):
        current_tenant = Tenant(name="Current")
        foreign_tenant = Tenant(name="Foreign")
        current_account = Account(name="Current", email="current@example.com")
        foreign_account = Account(name="Foreign", email="foreign@example.com")
        sqlite_session.add_all([current_tenant, foreign_tenant, current_account, foreign_account])
        sqlite_session.flush()
        sqlite_session.add_all(
            [
                TenantAccountJoin(
                    tenant_id=current_tenant.id,
                    account_id=current_account.id,
                    role=TenantAccountRole.NORMAL,
                ),
                TenantAccountJoin(
                    tenant_id=foreign_tenant.id,
                    account_id=foreign_account.id,
                    role=TenantAccountRole.NORMAL,
                ),
            ]
        )
        sqlite_session.commit()

        result = rbac_mod._account_names_by_ids(
            current_tenant.id,
            [current_account.id, foreign_account.id],
        )

        assert set(result) == {current_account.id}


class TestTenantScopedMemberReads:
    @pytest.mark.parametrize(
        ("resource_class", "service_method", "method_args", "resource_type"),
        [
            (
                rbac_mod.RBACAppMemberBindingsApi,
                "controllers.console.workspace.rbac.svc.RBACService.AppAccess.list_member_bindings",
                ("app-1", "policy-1"),
                "app",
            ),
            (
                rbac_mod.RBACDatasetMemberBindingsApi,
                "controllers.console.workspace.rbac.svc.RBACService.DatasetAccess.list_member_bindings",
                ("dataset-1", "policy-1"),
                "dataset",
            ),
            (
                rbac_mod.RBACWorkspaceAppMemberBindingsApi,
                "controllers.console.workspace.rbac.svc.RBACService.WorkspaceAccess.list_app_member_bindings",
                ("policy-1",),
                "app",
            ),
            (
                rbac_mod.RBACWorkspaceDatasetMemberBindingsApi,
                "controllers.console.workspace.rbac.svc.RBACService.WorkspaceAccess.list_dataset_member_bindings",
                ("policy-1",),
                "dataset",
            ),
        ],
    )
    def test_member_binding_reads_filter_foreign_accounts(
        self,
        resource_class,
        service_method,
        method_args,
        resource_type,
    ):
        bindings = rbac_mod.svc.MemberBindingsResponse(
            data=[
                {
                    "id": "binding-1",
                    "access_policy_id": "policy-1",
                    "resource_type": resource_type,
                    "account_id": "acct-1",
                    "account_name": "forged",
                },
                {
                    "id": "binding-2",
                    "access_policy_id": "policy-1",
                    "resource_type": resource_type,
                    "account_id": "foreign",
                    "account_name": "Foreign",
                },
            ]
        )

        with (
            patch("controllers.console.workspace.rbac._current_ids", return_value=("tenant-1", "acct-actor")),
            patch(service_method, return_value=bindings),
            patch(
                "controllers.console.workspace.rbac._account_names_by_ids",
                return_value={"acct-1": {"name": "Alice", "avatar": "avatar", "email": "alice@example.com"}},
            ),
        ):
            response = inspect.unwrap(resource_class.get)(resource_class(), *method_args)

        assert [binding["account_id"] for binding in response["data"]] == ["acct-1"]
        assert response["data"][0]["account_name"] == "Alice"

    def test_role_member_pagination_uses_local_workspace_members(self, app):
        members = [
            SimpleNamespace(
                id="acct-3",
                name="Carol",
                roles=(SimpleNamespace(id="role-1"),),
            ),
            SimpleNamespace(
                id="acct-1",
                name="Alice",
                roles=(SimpleNamespace(id="role-1"),),
            ),
            SimpleNamespace(
                id="acct-2",
                name="Bob",
                roles=(SimpleNamespace(id="role-2"),),
            ),
        ]
        member_queries = SimpleNamespace(list_for_workspace=lambda *_: members)

        with (
            app.test_request_context("/?page=2&limit=1"),
            patch("controllers.console.workspace.rbac._current_ids", return_value=("tenant-1", "acct-actor")),
            patch(
                "controllers.console.workspace.rbac.application_services",
                return_value=SimpleNamespace(workspace_member_queries=member_queries),
            ),
        ):
            response = inspect.unwrap(rbac_mod.ListMembersByRole.get)(rbac_mod.ListMembersByRole(), "role-1")

        assert response == {
            "data": [{"account_id": "acct-3", "account_name": "Carol"}],
            "pagination": {
                "total_count": 2,
                "per_page": 1,
                "current_page": 2,
                "total_pages": 2,
            },
        }


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

    def test_user_access_policy_payload_rejects_batch_account_ids(self):
        with pytest.raises(ValidationError):
            rbac_mod._ReplaceUserAccessPoliciesPayload.model_validate(
                {"access_policy_ids": ["policy-1"], "account_ids": ["foreign-account"]}
            )

    def test_user_access_policy_payload_coerces_null_ids(self):
        payload = rbac_mod._ReplaceUserAccessPoliciesPayload.model_validate({"access_policy_ids": None})
        assert payload.access_policy_ids == []

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
    @pytest.mark.parametrize(
        ("resource_class", "service_method", "resource_id"),
        [
            (
                rbac_mod.RBACAppWhitelistApi,
                "controllers.console.workspace.rbac.svc.RBACService.AppAccess.whitelist",
                "app-1",
            ),
            (
                rbac_mod.RBACDatasetWhitelistApi,
                "controllers.console.workspace.rbac.svc.RBACService.DatasetAccess.whitelist",
                "dataset-1",
            ),
        ],
    )
    def test_whitelist_get_filters_foreign_accounts(self, app, resource_class, service_method, resource_id):
        whitelist = rbac_mod.svc.ResourceWhitelist(account_ids=["acct-1", "foreign"])
        with (
            app.test_request_context("/"),
            patch("controllers.console.workspace.rbac._current_ids", return_value=("tenant-1", "acct-actor")),
            patch(service_method, return_value=whitelist) as mock_whitelist,
            patch(
                "controllers.console.workspace.rbac._account_names_by_ids",
                return_value={"acct-1": {"name": "Alice", "avatar": "", "email": "alice@example.com"}},
            ),
        ):
            response = inspect.unwrap(resource_class.get)(resource_class(), resource_id)

        assert response["account_ids"] == ["acct-1"]
        mock_whitelist.assert_called_once_with("tenant-1", "acct-actor", resource_id)

    @pytest.mark.parametrize(
        ("resource_class", "service_method", "resource_id"),
        _USER_ACCESS_POLICY_CASES,
    )
    def test_user_access_policy_assignment_forwards_ids(
        self,
        app,
        resource_class,
        service_method,
        resource_id,
    ):
        with (
            app.test_request_context(
                "/",
                method="PUT",
                json={"access_policy_ids": ["policy-1", "policy-2"]},
            ),
            patch("controllers.console.workspace.rbac._current_ids", return_value=("tenant-1", "acct-actor")),
            patch(service_method) as mock_replace,
            patch("controllers.console.workspace.rbac._dump", return_value={}),
        ):
            inspect.unwrap(resource_class.put)(resource_class(), resource_id, "acct-target")

        tenant_id, actor_id, actual_resource_id, target_id, payload = mock_replace.call_args.args
        assert (tenant_id, actor_id, actual_resource_id, target_id) == (
            "tenant-1",
            "acct-actor",
            resource_id,
            "acct-target",
        )
        assert payload.access_policy_ids == ["policy-1", "policy-2"]

    @pytest.mark.parametrize(
        ("resource_class", "service_method", "resource_id"),
        _USER_ACCESS_POLICY_CASES,
    )
    def test_user_access_policy_assignment_rejects_foreign_accounts(
        self,
        app,
        resource_class,
        service_method,
        resource_id,
    ):
        with (
            app.test_request_context("/", method="PUT", json={"access_policy_ids": ["policy-1"]}),
            patch("controllers.console.workspace.rbac._current_ids", return_value=("tenant-1", "acct-actor")),
            patch(service_method, side_effect=rbac_mod.MemberNotInTenantError("Member not in tenant.")),
            pytest.raises(NotFound, match="Member not in tenant"),
        ):
            inspect.unwrap(resource_class.put)(resource_class(), resource_id, "foreign")

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


class TestWorkspaceBindings:
    @pytest.mark.parametrize(
        ("resource_class", "service_method"),
        _WORKSPACE_BINDING_CASES,
    )
    def test_replace_bindings_filters_foreign_accounts(
        self,
        app,
        resource_class,
        service_method,
    ):
        result = rbac_mod.svc.AccessMatrixItem(
            accounts=[
                {"account_id": "acct-1", "account_name": "forged", "binding_id": "binding-1"},
                {"account_id": "foreign", "account_name": "Foreign", "binding_id": "binding-2"},
            ]
        )

        with (
            app.test_request_context(
                "/",
                method="PUT",
                json={"role_ids": ["role-1"], "account_ids": ["acct-1", "foreign"]},
            ),
            patch("controllers.console.workspace.rbac._current_ids", return_value=("tenant-1", "acct-actor")),
            patch(service_method, return_value=result) as mock_replace,
            patch(
                "controllers.console.workspace.rbac._account_names_by_ids",
                return_value={"acct-1": {"name": "Alice", "avatar": "avatar", "email": "alice@example.com"}},
            ),
        ):
            response = inspect.unwrap(resource_class.put)(resource_class(), "policy-1")

        assert [account["account_id"] for account in response["accounts"]] == ["acct-1"]
        assert response["accounts"][0]["account_name"] == "Alice"
        tenant_id, actor_id, policy_id, payload = mock_replace.call_args.args
        assert (tenant_id, actor_id, policy_id) == ("tenant-1", "acct-actor", "policy-1")
        assert payload.role_ids == ["role-1"]
        assert payload.account_ids == ["acct-1", "foreign"]

    @pytest.mark.parametrize(
        ("resource_class", "service_method"),
        _WORKSPACE_BINDING_CASES,
    )
    def test_replace_bindings_rejects_foreign_accounts(self, app, resource_class, service_method):
        with (
            app.test_request_context(
                "/",
                method="PUT",
                json={"role_ids": [], "account_ids": ["foreign"]},
            ),
            patch("controllers.console.workspace.rbac._current_ids", return_value=("tenant-1", "acct-actor")),
            patch(service_method, side_effect=rbac_mod.MemberNotInTenantError("Member not in tenant.")),
            pytest.raises(rbac_mod.BadRequest, match="Member not in tenant"),
        ):
            inspect.unwrap(resource_class.put)(resource_class(), "policy-1")


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
                rbac_mod.RBACRolesApi(api=SimpleNamespace(_validate=False)).dispatch_request()

        mock_create.assert_not_called()

    @pytest.mark.parametrize(
        ("policy_class", "legacy_gate", "resource_type", "permission", "resource_required"),
        [
            (
                rbac_mod._AppAccessConfigResource,
                rbac_mod.edit_permission_required,
                rbac_mod.RBACResourceScope.APP,
                rbac_mod.RBACPermission.APP_ACCESS_CONFIG,
                True,
            ),
            (
                rbac_mod._DatasetAccessConfigResource,
                rbac_mod.is_admin_or_owner_required,
                rbac_mod.RBACResourceScope.DATASET,
                rbac_mod.RBACPermission.DATASET_ACCESS_CONFIG,
                True,
            ),
            (
                rbac_mod._WorkspaceRoleManageResource,
                rbac_mod.is_admin_or_owner_required,
                rbac_mod.RBACResourceScope.WORKSPACE,
                rbac_mod.RBACPermission.WORKSPACE_ROLE_MANAGE,
                False,
            ),
        ],
    )
    def test_shared_management_policy(
        self,
        policy_class,
        legacy_gate,
        resource_type,
        permission,
        resource_required,
    ):
        permission_gate, actual_legacy_gate, auth_gate = policy_class.method_decorators
        closure = inspect.getclosurevars(permission_gate).nonlocals

        assert actual_legacy_gate is legacy_gate
        assert auth_gate is rbac_mod.login_required
        assert closure["resource_required"] is resource_required
        assert closure["resource_type"] is resource_type
        assert closure["scene"] is permission

    @pytest.mark.parametrize(
        ("policy_class", "resource_classes"),
        [
            (
                rbac_mod._AppAccessConfigResource,
                (
                    rbac_mod.RBACAppMatrixApi,
                    rbac_mod.RBACAppWhitelistApi,
                    rbac_mod.RBACAppUserAccessPoliciesApi,
                    rbac_mod.RBACAppUserAccessPolicyAssignmentApi,
                    rbac_mod.RBACAppRoleBindingsApi,
                    rbac_mod.RBACAppMemberBindingsApi,
                ),
            ),
            (
                rbac_mod._DatasetAccessConfigResource,
                (
                    rbac_mod.RBACDatasetMatrixApi,
                    rbac_mod.RBACDatasetWhitelistApi,
                    rbac_mod.RBACDatasetUserAccessPoliciesApi,
                    rbac_mod.RBACDatasetUserAccessPolicyAssignmentApi,
                    rbac_mod.RBACDatasetRoleBindingsApi,
                    rbac_mod.RBACDatasetMemberBindingsApi,
                ),
            ),
            (
                rbac_mod._WorkspaceRoleManageResource,
                (
                    rbac_mod.RBACRolesApi,
                    rbac_mod.RBACRoleItemApi,
                    rbac_mod.RBACRoleCopyApi,
                    rbac_mod.RBACAccessPoliciesApi,
                    rbac_mod.RBACAccessPolicyItemApi,
                    rbac_mod.RBACAccessPolicyCopyApi,
                    rbac_mod.RBACAccessPolicyBindingLockApi,
                    rbac_mod.RBACAccessPolicyBindingUnlockApi,
                    rbac_mod.RBACWorkspaceAppMatrixApi,
                    rbac_mod.RBACWorkspaceAppRoleBindingsApi,
                    rbac_mod.RBACWorkspaceAppBindingsApi,
                    rbac_mod.RBACWorkspaceAppMemberBindingsApi,
                    rbac_mod.RBACWorkspaceDatasetMatrixApi,
                    rbac_mod.RBACWorkspaceDatasetRoleBindingsApi,
                    rbac_mod.RBACWorkspaceDatasetBindingsApi,
                    rbac_mod.RBACWorkspaceDatasetMemberBindingsApi,
                    rbac_mod.ListMembersByRole,
                ),
            ),
        ],
    )
    def test_management_routes_share_policy(self, policy_class, resource_classes):
        assert all(issubclass(resource_class, policy_class) for resource_class in resource_classes)

    def test_member_role_update_requires_workspace_role_manage(self, app):
        with (
            app.test_request_context(
                "/workspaces/current/rbac/members/00000000-0000-0000-0000-000000000002/rbac-roles",
                method="PUT",
                json={"role_ids": ["role-1"]},
            ),
            patch(
                "controllers.common.wraps.current_account_with_tenant",
                return_value=(_account(), "tenant-1"),
            ),
            patch("controllers.common.wraps.RBACService.CheckAccess.check", return_value=False),
            patch("controllers.console.workspace.rbac.svc.RBACService.MemberRoles.replace_user_roles") as mock_replace,
        ):
            with pytest.raises(Forbidden):
                rbac_mod.RBACMemberRolesApi().put("00000000-0000-0000-0000-000000000002")

        mock_replace.assert_not_called()

    def test_member_role_read_remains_available_without_role_manage(self, app):
        response = rbac_mod.svc.MemberRolesResponse(account_id="acct-2")
        with (
            app.test_request_context(
                "/workspaces/current/rbac/members/00000000-0000-0000-0000-000000000002/rbac-roles"
            ),
            patch("libs.login.dify_config.LOGIN_DISABLED", True),
            patch("controllers.console.workspace.rbac._current_ids", return_value=("tenant-1", "acct-1")),
            patch(
                "controllers.console.workspace.rbac.svc.RBACService.MemberRoles.get",
                return_value=response,
            ) as mock_get,
            patch("controllers.common.wraps.RBACService.CheckAccess.check") as mock_check,
        ):
            result = rbac_mod.RBACMemberRolesApi(api=SimpleNamespace(_validate=False)).dispatch_request(
                member_id="00000000-0000-0000-0000-000000000002",
            )

        assert isinstance(result, dict)
        assert result["account_id"] == "acct-2"
        mock_get.assert_called_once()
        mock_check.assert_not_called()

    def test_member_role_read_maps_foreign_member_to_not_found(self, app):
        with (
            app.test_request_context("/"),
            patch("controllers.console.workspace.rbac._current_ids", return_value=("tenant-1", "acct-1")),
            patch(
                "controllers.console.workspace.rbac.svc.RBACService.MemberRoles.get",
                side_effect=rbac_mod.MemberNotInTenantError("missing"),
            ),
            pytest.raises(NotFound, match="missing"),
        ):
            inspect.unwrap(rbac_mod.RBACMemberRolesApi.get)(rbac_mod.RBACMemberRolesApi(), "foreign")

    def test_member_role_update_returns_updated_roles(self, app):
        updated = rbac_mod.svc.MemberRolesResponse(account_id="acct-2")
        with (
            app.test_request_context("/", method="PUT", json={"role_ids": ["role-1"]}),
            patch("controllers.console.workspace.rbac._current_ids", return_value=("tenant-1", "acct-1")),
            patch(
                "controllers.console.workspace.rbac.svc.RBACService.MemberRoles.replace_user_roles",
                return_value=updated,
            ) as mock_replace,
        ):
            response = inspect.unwrap(rbac_mod.RBACMemberRolesApi.put)(rbac_mod.RBACMemberRolesApi(), "acct-2")

        assert response["account_id"] == "acct-2"
        mock_replace.assert_called_once_with("tenant-1", "acct-1", "acct-2", role_ids=["role-1"])

    @pytest.mark.parametrize(
        ("error", "http_error"),
        [
            (rbac_mod.CannotOperateSelfError("self"), rbac_mod.BadRequest),
            (rbac_mod.RoleAlreadyAssignedError("assigned"), rbac_mod.BadRequest),
            (rbac_mod.NoPermissionError("denied"), rbac_mod.Forbidden),
            (rbac_mod.MemberNotInTenantError("missing"), rbac_mod.NotFound),
        ],
    )
    def test_member_role_update_maps_service_errors(self, app, error, http_error):
        with (
            app.test_request_context(
                "/workspaces/current/rbac/members/00000000-0000-0000-0000-000000000002/rbac-roles",
                method="PUT",
                json={"role_ids": ["role-1"]},
            ),
            patch("controllers.console.workspace.rbac._current_ids", return_value=("tenant-1", "acct-1")),
            patch(
                "controllers.console.workspace.rbac.svc.RBACService.MemberRoles.replace_user_roles",
                side_effect=error,
            ),
        ):
            with pytest.raises(http_error):
                inspect.unwrap(rbac_mod.RBACMemberRolesApi.put)(
                    rbac_mod.RBACMemberRolesApi(),
                    "00000000-0000-0000-0000-000000000002",
                )


class TestDumpHelper:
    def test_dump_returns_plain_dict(self):
        role = rbac_mod.svc.RBACRole(id="role-1", type="workspace", name="Owner")
        dumped = rbac_mod._dump(role)
        assert isinstance(dumped, dict)
        assert "role_id" not in dumped
